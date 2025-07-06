import { debugElement, bodyPath } from './domElements.js';
import { ContourTracer } from './contour.js';

export class PoseProcessor {
    constructor() {
        this.blazePose = null;
        this.debugElement = debugElement;
        this.contourTracer = new ContourTracer({
            curveType: 'quadratic',
            curveTension: 0.5
        });
        this.hasReceivedFirstSegmentation = false;
        this.frameProcessingCount = 0;
        this.modelPreloaded = false;
        this.modelPreloadPromise = null;

        // Create OffscreenCanvas for mask processing
        this.maskCanvas = new OffscreenCanvas(640, 480);
        this.maskCtx = this.maskCanvas.getContext('2d', { willReadFrequently: true });
    }

    updateDebug(message) {
        if (this.debugElement) {
            this.debugElement.textContent = `Status: ${message}`;
        }
        console.log('Debug:', message);
    }

    setDimensions(width, height) {
        this.maskCanvas.width = width;
        this.maskCanvas.height = height;
    }

    // Preload the model in background
    async preloadModel() {
        if (this.modelPreloadPromise) {
            return this.modelPreloadPromise;
        }

        this.modelPreloadPromise = new Promise(async (resolve, reject) => {
            try {
                console.log('Starting background model preload...');

                // Wait for MediaPipe to be available
                await this.waitForMediaPipe();

                // Create a temporary pose instance just to trigger model download
                const tempPose = new window.Pose({
                    locateFile: (file) => {
                        console.log('Preloading MediaPipe file:', file);
                        return `https://cdn.jsdelivr.net/npm/@mediapipe/pose@0.5.1675469404/${file}`;
                    }
                });

                // Set options to trigger model initialization
                tempPose.setOptions({
                    modelComplexity: 1,
                    smoothLandmarks: true,
                    enableSegmentation: true,
                    smoothSegmentation: true,
                    minDetectionConfidence: 0.5,
                    minTrackingConfidence: 0.5
                });

                // Wait for model to be ready by sending a dummy frame
                const canvas = new OffscreenCanvas(64, 64);
                const ctx = canvas.getContext('2d');
                ctx.fillStyle = 'black';
                ctx.fillRect(0, 0, 64, 64);

                tempPose.onResults((results) => {
                    console.log('Model preload complete - received dummy results');
                    // Store the preloaded model
                    this.blazePose = tempPose;
                    this.modelPreloaded = true;
                    resolve(tempPose);
                });

                // Send dummy frame to initialize model
                const bitmap = await createImageBitmap(canvas);
                await tempPose.send({ image: bitmap });
                bitmap.close();

            } catch (error) {
                console.error('Model preload failed:', error);
                reject(error);
            }
        });

        return this.modelPreloadPromise;
    }

    async initializeBlazePose() {
        try {
            this.updateDebug('Loading AI model...');

            if (this.modelPreloaded && this.modelPreloadPromise) {
                // Use the preloaded model
                this.updateDebug('Using preloaded AI model...');
                this.blazePose = await this.modelPreloadPromise;
            } else {
                // Fallback to normal loading
                this.updateDebug('Loading AI model...');
                await this.waitForMediaPipe();

                this.blazePose = new window.Pose({
                    locateFile: (file) => {
                        console.log('Loading MediaPipe file:', file);
                        if (file.includes('.wasm')) {
                            this.updateDebug('Downloading AI model weights... (this may take a moment)');
                        }
                        return `https://cdn.jsdelivr.net/npm/@mediapipe/pose@0.5.1675469404/${file}`;
                    }
                });

                this.blazePose.setOptions({
                    modelComplexity: 1,
                    smoothLandmarks: true,
                    enableSegmentation: true,
                    smoothSegmentation: true,
                    minDetectionConfidence: 0.5,
                    minTrackingConfidence: 0.5
                });
            }

            this.updateDebug('Connecting AI model to camera stream...');
            this.blazePose.onResults(this.onPoseResults.bind(this));

            this.updateDebug('AI model ready! Body tracking active.');
            console.log('MediaPipe BlazePose initialized successfully');

        } catch (error) {
            console.error('Pose segmentation initialization failed:', error);
            this.updateDebug(`AI model error: ${error.message}`);
            throw error;
        }
    }

    // Helper method to wait for MediaPipe to be available
    async waitForMediaPipe() {
        return new Promise((resolve, reject) => {
            let attempts = 0;
            const maxAttempts = 50; // 5 seconds max wait

            const checkMediaPipe = () => {
                attempts++;

                if (typeof window.Pose !== 'undefined') {
                    console.log('MediaPipe Pose is ready');
                    resolve();
                } else if (attempts >= maxAttempts) {
                    reject(new Error('MediaPipe Pose failed to load within timeout'));
                } else {
                    // Check again in 100ms
                    setTimeout(checkMediaPipe, 50);
                }
            };

            checkMediaPipe();
        });
    }

    async processFrame(frame) {
        try {
            this.frameProcessingCount++;

            // Show periodic updates about frame processing
            if (this.frameProcessingCount % 30 === 0) { // Every 30 frames (~1 second at 30fps)
                this.updateDebug(`Processing frames... (${this.frameProcessingCount} processed)`);
            }

            // Create ImageBitmap from VideoFrame for efficient processing
            const bitmap = await createImageBitmap(frame);

            // Send to MediaPipe if available
            if (this.blazePose) {
                await this.blazePose.send({ image: bitmap });
            }

            // Clean up
            bitmap.close();
            frame.close();

        } catch (error) {
            console.error('Frame processing error:', error);
            // Always close the frame to prevent memory leaks
            frame.close();
        }
    }

    onPoseResults(results) {
        console.log('Pose results received:', {
            hasSegmentationMask: !!results.segmentationMask,
            hasLandmarks: !!results.poseLandmarks,
            timestamp: Date.now()
        });

        if (results.segmentationMask) {
            // Update status when we get our first segmentation
            if (!this.hasReceivedFirstSegmentation) {
                this.hasReceivedFirstSegmentation = true;
                this.updateDebug('First body detection received! Drawing outline...');
            }
            this.drawBodyOutline(results.segmentationMask);
        } else {
            // Clear the SVG path when no person is detected
            if (bodyPath) {
                bodyPath.setAttribute('d', '');
            }

            // Show status when we're not detecting a person
            if (this.hasReceivedFirstSegmentation) {
                this.updateDebug('Body tracking active - move into camera view');
            } else {
                this.updateDebug('Body tracking active - waiting for person detection...');
            }
        }
    }

    async drawBodyOutline(segmentationMask) {
        try {
            console.log('Processing ImageBitmap segmentation mask...');

            // Since segmentationMask is ImageBitmap, draw it to canvas to get ImageData
            this.maskCtx.clearRect(0, 0, this.maskCanvas.width, this.maskCanvas.height);
            this.maskCtx.drawImage(segmentationMask, 0, 0);

            const imageData = this.maskCtx.getImageData(0, 0, this.maskCanvas.width, this.maskCanvas.height);
            const width = imageData.width;
            const height = imageData.height;
            const data = imageData.data;

            // Create binary mask from the ImageData
            const binaryMask = new Array(width * height);
            let personPixelCount = 0;

            // MediaPipe uses the alpha channel for segmentation
            for (let i = 0; i < width * height; i++) {
                const pixelIndex = i * 4;
                const alpha = data[pixelIndex + 3];
                binaryMask[i] = alpha > 128 ? 1 : 0;
                if (binaryMask[i] === 1) personPixelCount++;
            }

            // Create segmentation object compatible with ContourTracer
            const segmentation = {
                width: width,
                height: height,
                data: binaryMask
            };

            // Extract contours
            const contours = this.contourTracer.extractContours(segmentation);

            // Convert contours to SVG path
            const pathData = this.contourTracer.contoursToSVGPath(contours);

            // Update SVG path
            if (bodyPath && pathData) {
                bodyPath.setAttribute('d', pathData);
            } else if (!bodyPath) {
                console.error('bodyPath element not found');
            }
        } catch (error) {
            console.error('Body outline error:', error);
        }
    }

    cleanup() {
        // Clear any ongoing processing
        this.hasReceivedFirstSegmentation = false;
        this.frameProcessingCount = 0;

        // Clear SVG
        if (bodyPath) {
            bodyPath.setAttribute('d', '');
        }

        // Clean up BlazePose model
        if (this.blazePose) {
            this.blazePose.close();
            this.blazePose = null;
        }

        // Reset model state
        this.modelPreloaded = false;
        this.modelPreloadPromise = null;

        this.updateDebug('Pose processor cleaned up');
    }
}
