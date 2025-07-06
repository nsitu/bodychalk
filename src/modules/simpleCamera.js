import { canvas, debugElement, maskCanvas, bodyPath } from './domElements.js';
import { ContourTracer } from './contour.js';

export class SimpleCameraManager {
    constructor() {
        this.canvas = canvas;
        this.maskCanvas = maskCanvas;
        this.ctx = this.canvas.getContext('2d');
        this.maskCtx = this.maskCanvas.getContext('2d');
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
    }

    updateDebug(message) {
        if (this.debugElement) {
            this.debugElement.textContent = `Status: ${message}`;
        }
        console.log('Debug:', message);
    }

    async initialize() {
        try {
            this.updateDebug('Requesting camera access...');

            // Get user media stream
            this.stream = await navigator.mediaDevices.getUserMedia({
                video: {
                    width: { ideal: this.videoWidth },
                    height: { ideal: this.videoHeight },
                    facingMode: 'user'
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

            // Initialize BlazePose
            setTimeout(() => {
                this.initializeBlazePose();
            }, 1000);

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

    async initializeBlazePose() {
        try {
            this.updateDebug('Loading AI model...');

            // Initialize MediaPipe Pose
            if (typeof window.Pose === 'undefined') {
                throw new Error('MediaPipe Pose not loaded');
            }

            console.log('Using MediaPipe BlazePose');

            this.blazePose = new window.Pose({
                locateFile: (file) => {
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

            this.blazePose.onResults(this.onPoseResults.bind(this));

            this.updateDebug('AI model loaded! Body tracking active.');
            console.log('MediaPipe BlazePose initialized successfully');

        } catch (error) {
            console.error('Pose segmentation initialization failed:', error);
            this.updateDebug(`AI model error: ${error.message}`);
        }
    }

    async processFrame(frame) {
        try {
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
        if (results.segmentationMask) {
            this.drawBodyOutline(results.segmentationMask);
        }
    }

    async drawBodyOutline(segmentationMask) {
        try {
            console.log('Segmentation mask type:', typeof segmentationMask);
            console.log('Segmentation mask:', segmentationMask);

            // Handle different MediaPipe segmentation mask formats
            let imageData;
            let width, height;

            if (segmentationMask instanceof ImageData) {
                // Already ImageData
                imageData = segmentationMask;
                width = imageData.width;
                height = imageData.height;
            } else if (segmentationMask.data && segmentationMask.width && segmentationMask.height) {
                // Custom format with data, width, height
                width = segmentationMask.width;
                height = segmentationMask.height;
                imageData = {
                    data: segmentationMask.data,
                    width: width,
                    height: height
                };
            } else if (segmentationMask.arrayBuffer) {
                // ArrayBuffer format - need to convert
                const buffer = await segmentationMask.arrayBuffer();
                const uint8Array = new Uint8Array(buffer);
                width = this.videoWidth;
                height = this.videoHeight;
                imageData = {
                    data: uint8Array,
                    width: width,
                    height: height
                };
            } else {
                // Try to draw on canvas to get ImageData
                this.maskCtx.clearRect(0, 0, this.maskCanvas.width, this.maskCanvas.height);
                this.maskCtx.drawImage(segmentationMask, 0, 0);
                imageData = this.maskCtx.getImageData(0, 0, this.maskCanvas.width, this.maskCanvas.height);
                width = imageData.width;
                height = imageData.height;
            }

            const data = imageData.data;

            // Create binary mask from alpha channel or red channel
            const binaryMask = new Array(width * height);
            let personPixelCount = 0;

            for (let i = 0; i < width * height; i++) {
                // MediaPipe segmentation often uses alpha channel or red channel
                let maskValue;
                if (data.length === width * height * 4) {
                    // RGBA format - use alpha channel or red channel
                    maskValue = data[i * 4 + 3] || data[i * 4]; // Alpha or Red
                } else if (data.length === width * height) {
                    // Grayscale format
                    maskValue = data[i];
                } else {
                    // Fallback to red channel
                    maskValue = data[i * 4];
                }

                binaryMask[i] = maskValue > 128 ? 1 : 0;
                if (binaryMask[i] === 1) personPixelCount++;
            }

            console.log(`Mask dimensions: ${width}x${height}, Person pixels: ${personPixelCount}`);

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
}
