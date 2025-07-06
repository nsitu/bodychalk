import { canvas, debugElement, maskCanvas, bodyPath } from './domElements.js';
import { ContourTracer } from './contour.js';

export class SimpleCameraManager {
    constructor() {
        this.canvas = canvas;
        this.maskCanvas = maskCanvas;
        this.ctx = this.canvas.getContext('2d');

        // Optimize mask canvas context for frequent readback operations
        this.maskCtx = this.maskCanvas.getContext('2d', { willReadFrequently: true });

        this.contourTracer = new ContourTracer({
            curveType: 'quadratic',
            curveTension: 0.5
        });
        this.isProcessing = false;
        this.debugElement = debugElement;
        this.blazePose = null;
        this.stream = null;
        this.reader = null;
        this.videoWidth = 640;
        this.videoHeight = 480;
        this.hasReceivedFirstSegmentation = false;
        this.frameProcessingCount = 0;
        this.modelPreloaded = false;
        this.modelPreloadPromise = null;

        this.currentFacingMode = 'user'; // default
        this.availableFacingModes = ['user'];
        this.hasBothCameras = false;
    }

    updateDebug(message) {
        if (this.debugElement) {
            this.debugElement.textContent = `Status: ${message}`;
        }
        console.log('Debug:', message);
    }

    async initialize() {
        try {
            // Check available cameras first
            const cameraInfo = await this.getAvailableCameras();
            this.availableFacingModes = cameraInfo.facingModes;
            this.hasBothCameras = cameraInfo.hasBothCameras;
            
            // Show camera toggle button if both cameras are available
            if (this.hasBothCameras) {
                this.showCameraToggle();
            }
            
            this.updateDebug('Requesting camera access...');

            // Get user media stream with current facing mode
            this.stream = await navigator.mediaDevices.getUserMedia({
                video: {
                    width: { ideal: this.videoWidth },
                    height: { ideal: this.videoHeight },
                    facingMode: this.currentFacingMode
                }
            });

            this.updateDebug('Camera access granted, setting up stream processor...');

            // Check if MediaStreamTrackProcessor is supported
            if (!window.MediaStreamTrackProcessor) {
                throw new Error('MediaStreamTrackProcessor not supported in this browser');
            }

            // Get video track and create processor
            const track = this.stream.getVideoTracks()[0];
            const processor = new MediaStreamTrackProcessor({ track });
            this.reader = processor.readable.getReader();

            // Get first frame to determine actual dimensions
            const { value: firstFrame } = await this.reader.read();
            this.videoWidth = firstFrame.displayWidth;
            this.videoHeight = firstFrame.displayHeight;

            this.updateDebug('Stream processor ready, setting up canvas...');

            // Set canvas dimensions
            this.setupCanvas();

            // Process the first frame
            await this.processFrame(firstFrame);

            this.updateDebug('Starting frame processing...');
            // Start processing frames
            this.startProcessing();

            this.updateDebug('Camera ready! Loading AI model...');

            // Initialize BlazePose when dependencies are ready
            await this.initializeBlazePose();

            return true;
        } catch (error) {
            this.updateDebug(`Error: ${error.message}`);
            console.error('Camera initialization failed:', error);
            throw error;
        }
    }

    setupCanvas() {
        // Set canvas dimensions
        this.canvas.width = this.videoWidth;
        this.canvas.height = this.videoHeight;
        this.maskCanvas.width = this.videoWidth;
        this.maskCanvas.height = this.videoHeight;

        // Set canvas style to fit screen
        const aspectRatio = this.videoWidth / this.videoHeight;
        const windowAspectRatio = window.innerWidth / window.innerHeight;

        let canvasWidth, canvasHeight;
        if (aspectRatio > windowAspectRatio) {
            canvasWidth = '100vw';
            canvasHeight = 'auto';
        } else {
            canvasWidth = 'auto';
            canvasHeight = '100vh';
        }

        // Apply styling to canvases (hidden since we only want SVG output)
        this.canvas.style.width = canvasWidth;
        this.canvas.style.height = canvasHeight;
        this.canvas.style.display = 'none'; // Hide canvas since we only want SVG
        this.maskCanvas.style.width = canvasWidth;
        this.maskCanvas.style.height = canvasHeight;
        this.maskCanvas.style.display = 'none'; // Hide mask canvas

        // Make sure SVG matches canvas dimensions and position
        const svg = document.getElementById('svg');
        if (svg) {
            svg.setAttribute('width', this.videoWidth);
            svg.setAttribute('height', this.videoHeight);
            svg.setAttribute('viewBox', `0 0 ${this.videoWidth} ${this.videoHeight}`);
            // SVG will be positioned via CSS to overlay the canvas
        }

        console.log('Canvas setup:', {
            videoWidth: this.videoWidth,
            videoHeight: this.videoHeight,
            canvasStyle: {
                width: this.canvas.style.width,
                height: this.canvas.style.height
            }
        });
    }

    // New method to preload the model in background
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
                    setTimeout(checkMediaPipe, 100);
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
            // Show status when we're not detecting a person
            if (this.hasReceivedFirstSegmentation) {
                this.updateDebug('Body tracking active - move into camera view');
            } else {
                this.updateDebug('Body tracking active - waiting for person detection...');
            }
        }
    }

    async drawBodyOutline(segmentationMask) {
        // console.log('Drawing body outline...');
        try {
            console.log('Segmentation mask type:', typeof segmentationMask);
            console.log('Segmentation mask:', segmentationMask);
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

    async startProcessing() {
        this.isProcessing = true;
        let frameCount = 0;

        try {
            while (this.isProcessing) {
                const { done, value: frame } = await this.reader.read();
                if (done) break;

                frameCount++;

                // Process every 3rd frame for better performance
                if (frameCount % 3 === 0) {
                    await this.processFrame(frame);
                } else {
                    // Still need to close unused frames
                    frame.close();
                }
            }
        } catch (error) {
            console.error('Stream processing error:', error);
            this.updateDebug(`Stream error: ${error.message}`);
        }
    }

    stop() {
        this.isProcessing = false;

        // Stop the stream reader
        if (this.reader) {
            this.reader.releaseLock();
            this.reader = null;
        }

        // Stop video stream
        if (this.stream) {
            this.stream.getTracks().forEach(track => track.stop());
            this.stream = null;
        }
    }

    async getAvailableCameras() {
        try {
            const devices = await navigator.mediaDevices.enumerateDevices();
            const videoDevices = devices.filter(device => device.kind === 'videoinput');
            
            console.log('Available video devices:', videoDevices);
            
            // Test which facing modes are available
            const availableFacingModes = [];
            
            // Test front camera (user)
            try {
                const userStream = await navigator.mediaDevices.getUserMedia({
                    video: { facingMode: 'user' }
                });
                availableFacingModes.push('user');
                userStream.getTracks().forEach(track => track.stop());
            } catch (e) {
                console.log('User facing camera not available');
            }
            
            // Test back camera (environment)
            try {
                const envStream = await navigator.mediaDevices.getUserMedia({
                    video: { facingMode: 'environment' }
                });
                availableFacingModes.push('environment');
                envStream.getTracks().forEach(track => track.stop());
            } catch (e) {
                console.log('Environment facing camera not available');
            }
            
            return {
                devices: videoDevices,
                facingModes: availableFacingModes,
                hasBothCameras: availableFacingModes.length > 1
            };
        } catch (error) {
            console.error('Error checking available cameras:', error);
            return {
                devices: [],
                facingModes: ['user'], // fallback to user
                hasBothCameras: false
            };
        }
    }

    async toggleCamera() {
        try {
            // Switch facing mode
            this.currentFacingMode = this.currentFacingMode === 'user' ? 'environment' : 'user';
            
            this.updateDebug(`Switching to ${this.currentFacingMode} camera...`);
            
            // Stop current stream
            if (this.stream) {
                this.stream.getTracks().forEach(track => track.stop());
            }
            
            // Stop current reader
            if (this.reader) {
                this.reader.releaseLock();
                this.reader = null;
            }
            
            // Get new stream with different facing mode
            this.stream = await navigator.mediaDevices.getUserMedia({
                video: {
                    width: { ideal: this.videoWidth },
                    height: { ideal: this.videoHeight },
                    facingMode: this.currentFacingMode
                }
            });
            
            // Set up new stream processor
            const track = this.stream.getVideoTracks()[0];
            const processor = new MediaStreamTrackProcessor({ track });
            this.reader = processor.readable.getReader();
            
            // Update camera toggle button text
            this.updateCameraToggleButton();
            
            // Resume processing
            this.startProcessing();
            
            this.updateDebug(`Switched to ${this.currentFacingMode} camera`);
            
        } catch (error) {
            console.error('Camera toggle failed:', error);
            this.updateDebug(`Camera toggle failed: ${error.message}`);
            
            // Try to revert to previous camera
            this.currentFacingMode = this.currentFacingMode === 'user' ? 'environment' : 'user';
        }
    }

    showCameraToggle() {
        // Create camera toggle button
        const toggleButton = document.createElement('button');
        toggleButton.id = 'cameraToggle';
        toggleButton.textContent = `Switch to ${this.currentFacingMode === 'user' ? 'Back' : 'Front'} Camera`;
        toggleButton.style.cssText = `
            position: absolute;
            top: 10px;
            left: 10px;
            background: rgba(0, 0, 0, 0.7);
            color: white;
            border: none;
            padding: 10px 15px;
            border-radius: 5px;
            cursor: pointer;
            font-size: 12px;
            z-index: 10;
        `;
        
        toggleButton.addEventListener('click', () => {
            this.toggleCamera();
        });
        
        // Add to app container
        const app = document.getElementById('app');
        if (app) {
            app.appendChild(toggleButton);
        }
    }

    updateCameraToggleButton() {
        const toggleButton = document.getElementById('cameraToggle');
        if (toggleButton) {
            toggleButton.textContent = `Switch to ${this.currentFacingMode === 'user' ? 'Back' : 'Front'} Camera`;
        }
    }
}
