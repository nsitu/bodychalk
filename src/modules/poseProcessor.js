import { debugElement, bodyPath } from './domElements.js';
import { ContourTracer } from './contour.js';
import { PoseLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';

export class PoseProcessor {
    constructor() {
        this.poseLandmarker = null;
        this.debugElement = debugElement;
        this.contourTracer = new ContourTracer({
            curveType: 'quadratic',
            curveTension: 0.5
        });
        this.hasReceivedFirstSegmentation = false;
        this.frameProcessingCount = 0;
        this.modelPreloaded = false;
        this.modelPreloadPromise = null;
        this.lastVideoTime = -1;
        this.isProcessing = false;

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

                // Create vision instance
                const vision = await FilesetResolver.forVisionTasks(
                    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.0/wasm"
                );

                // Create pose landmarker with segmentation enabled
                this.poseLandmarker = await PoseLandmarker.createFromOptions(vision, {
                    baseOptions: {
                        modelAssetPath: "./models/pose_landmarker_lite.task"
                    },
                    runningMode: "VIDEO",
                    numPoses: 1,
                    minPoseDetectionConfidence: 0.5,
                    minPosePresenceConfidence: 0.5,
                    minTrackingConfidence: 0.5,
                    outputSegmentationMasks: true
                });

                this.modelPreloaded = true;
                console.log('Model preload complete!');
                resolve(this.poseLandmarker);

            } catch (error) {
                console.error('Model preload failed:', error);
                reject(error);
            }
        });

        return this.modelPreloadPromise;
    }

    async initializePoseLandmarker() {
        try {
            this.updateDebug('Loading AI model...');

            if (this.modelPreloaded && this.modelPreloadPromise) {
                // Use the preloaded model
                this.updateDebug('Using preloaded AI model...');
                this.poseLandmarker = await this.modelPreloadPromise;
            } else {
                // Fallback to normal loading
                this.updateDebug('Loading AI model...');
                await this.waitForMediaPipe();

                // Create vision instance
                const vision = await FilesetResolver.forVisionTasks(
                    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.0/wasm"
                );

                // Create pose landmarker with segmentation enabled
                this.poseLandmarker = await PoseLandmarker.createFromOptions(vision, {
                    baseOptions: {
                        modelAssetPath: "./models/pose_landmarker_lite.task"
                    },
                    runningMode: "VIDEO",
                    numPoses: 1,
                    minPoseDetectionConfidence: 0.5,
                    minPosePresenceConfidence: 0.5,
                    minTrackingConfidence: 0.5,
                    outputSegmentationMasks: true
                });
            }

            this.updateDebug('AI model ready! Body tracking active.');
            console.log('MediaPipe Pose Landmarker initialized successfully');

        } catch (error) {
            console.error('Pose landmarker initialization failed:', error);
            this.updateDebug(`AI model error: ${error.message}`);
            throw error;
        }
    }

    // Helper method to wait for MediaPipe to be available
    async waitForMediaPipe() {
        // Since we're importing directly, MediaPipe should be available immediately
        // But we'll keep a simple check for the imports
        return new Promise((resolve, reject) => {
            if (typeof PoseLandmarker !== 'undefined' && typeof FilesetResolver !== 'undefined') {
                console.log('MediaPipe Tasks Vision is ready');
                resolve();
            } else {
                reject(new Error('MediaPipe Tasks Vision imports failed'));
            }
        });
    }

    async processFrame(frame) {
        try {
            // Prevent overlapping processing
            if (this.isProcessing) {
                frame.close();
                return;
            }

            this.isProcessing = true;
            this.frameProcessingCount++;

            // Show periodic updates about frame processing
            if (this.frameProcessingCount % 30 === 0) { // Every 30 frames (~1 second at 30fps)
                this.updateDebug(`Processing frames... (${this.frameProcessingCount} processed)`);
            }

            // Create ImageBitmap from VideoFrame for efficient processing
            const bitmap = await createImageBitmap(frame);

            // Send to MediaPipe if available
            if (this.poseLandmarker) {
                const startTimeMs = performance.now();
                const results = this.poseLandmarker.detectForVideo(bitmap, startTimeMs);
                this.onPoseResults(results);
            }

            // Clean up
            bitmap.close();
            frame.close();

        } catch (error) {
            console.error('Frame processing error:', error);
            // Always close the frame to prevent memory leaks
            frame.close();
        } finally {
            this.isProcessing = false;
        }
    }

    onPoseResults(results) {
        // Reduced logging for better performance
        if (Math.random() < 0.01) { // Log only occasionally
            console.log('Pose results received:', {
                hasSegmentationMasks: !!results.segmentationMasks && results.segmentationMasks.length > 0,
                hasLandmarks: !!results.landmarks && results.landmarks.length > 0,
                timestamp: Date.now()
            });
        }

        if (results.segmentationMasks && results.segmentationMasks.length > 0) {
            // Update status when we get our first segmentation
            if (!this.hasReceivedFirstSegmentation) {
                this.hasReceivedFirstSegmentation = true;
                this.updateDebug('First body detection received! Drawing outline...');
            }
            this.drawBodyOutline(results.segmentationMasks[0]);
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
            // Minimal logging for performance
            if (Math.random() < 0.01) {
                console.log('Processing segmentation mask...');
            }

            const width = segmentationMask.width;
            const height = segmentationMask.height;

            // MediaPipe segmentation masks store data in the 'g' property as Float32Array
            if (segmentationMask.g && segmentationMask.g.length > 0) {
                const maskData = segmentationMask.g[0]; // First (and likely only) array
                const binaryMask = new Array(width * height);
                let personPixelCount = 0;

                // Convert Float32Array to binary mask
                // MediaPipe segmentation values are typically 0.0 to 1.0
                for (let i = 0; i < maskData.length && i < width * height; i++) {
                    const value = maskData[i];
                    binaryMask[i] = value > 0.5 ? 1 : 0; // Threshold at 0.5
                    if (binaryMask[i] === 1) personPixelCount++;
                }

                // If no pixels found with 0.5 threshold, try lower threshold
                if (personPixelCount === 0) {
                    for (let i = 0; i < maskData.length && i < width * height; i++) {
                        const value = maskData[i];
                        binaryMask[i] = value > 0.1 ? 1 : 0; // Lower threshold
                        if (binaryMask[i] === 1) personPixelCount++;
                    }
                }

                // Only proceed if we found person pixels
                if (personPixelCount > 0) {
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
                    }
                }
            }
        } catch (error) {
            console.error('Body outline error:', error);
        }
    }

    cleanup() {
        // Clear any ongoing processing
        this.hasReceivedFirstSegmentation = false;
        this.frameProcessingCount = 0;
        this.isProcessing = false;

        // Clear SVG
        if (bodyPath) {
            bodyPath.setAttribute('d', '');
        }

        // Clean up Pose Landmarker
        if (this.poseLandmarker) {
            this.poseLandmarker.close();
            this.poseLandmarker = null;
        }

        // Reset model state
        this.modelPreloaded = false;
        this.modelPreloadPromise = null;

        this.updateDebug('Pose processor cleaned up');
    }
}
