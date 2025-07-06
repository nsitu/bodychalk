import { video, canvas, debugElement, maskCanvas, bodyPath } from './domElements.js';
import { ContourTracer } from './contour.js';

export class SimpleCameraManager {
    constructor() {
        this.video = video;
        this.canvas = canvas;
        this.maskCanvas = maskCanvas;
        this.ctx = this.canvas.getContext('2d');
        this.maskCtx = this.maskCanvas.getContext('2d');
        this.contourTracer = new ContourTracer();
        this.isProcessing = false;
        this.animationId = null;
        this.debugElement = debugElement;
        this.blazePose = null;
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

            // Get user media
            const stream = await navigator.mediaDevices.getUserMedia({
                video: {
                    width: { ideal: 640 },
                    height: { ideal: 480 },
                    facingMode: 'user'
                }
            });

            this.updateDebug('Camera access granted, setting up video...');
            this.video.srcObject = stream;

            // Wait for video to load
            await new Promise((resolve) => {
                this.video.onloadedmetadata = () => {
                    this.updateDebug('Video loaded, setting up canvas...');
                    // Ensure video starts playing
                    this.video.play().then(() => {
                        console.log('Video is now playing');
                        resolve();
                    }).catch(error => {
                        console.error('Error starting video playback:', error);
                        resolve(); // Continue anyway
                    });
                };
            });

            // Set canvas dimensions
            this.setupCanvas();

            this.updateDebug('Starting video feed...');
            // Start processing
            this.startProcessing();

            this.updateDebug('Camera ready! Loading AI model...');

            // Initialize BlazePose after camera is working
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
        const videoWidth = this.video.videoWidth;
        const videoHeight = this.video.videoHeight;

        // Set canvas dimensions
        this.canvas.width = videoWidth;
        this.canvas.height = videoHeight;
        this.maskCanvas.width = videoWidth;
        this.maskCanvas.height = videoHeight;

        // Set canvas style to fit screen
        const aspectRatio = videoWidth / videoHeight;
        const windowAspectRatio = window.innerWidth / window.innerHeight;

        let canvasWidth, canvasHeight;
        if (aspectRatio > windowAspectRatio) {
            canvasWidth = '100vw';
            canvasHeight = 'auto';
        } else {
            canvasWidth = 'auto';
            canvasHeight = '100vh';
        }

        // Apply the same styling to both canvases
        this.canvas.style.width = canvasWidth;
        this.canvas.style.height = canvasHeight;
        this.maskCanvas.style.width = canvasWidth;
        this.maskCanvas.style.height = canvasHeight;

        // Make sure SVG matches canvas dimensions and position
        const svg = document.getElementById('svg');
        if (svg) {
            svg.setAttribute('width', videoWidth);
            svg.setAttribute('height', videoHeight);
            svg.setAttribute('viewBox', `0 0 ${videoWidth} ${videoHeight}`);
            // SVG will be positioned via CSS to overlay the canvas
        }

        console.log('Canvas setup:', {
            videoWidth,
            videoHeight,
            canvasStyle: {
                width: this.canvas.style.width,
                height: this.canvas.style.height
            },
            videoElement: {
                readyState: this.video.readyState,
                videoWidth: this.video.videoWidth,
                videoHeight: this.video.videoHeight,
                paused: this.video.paused,
                currentTime: this.video.currentTime
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
                width = this.video.videoWidth;
                height = this.video.videoHeight;
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


    startProcessing() {
        let frameCount = 0;
        const processFrame = async () => {
            if (!this.isProcessing) return;

            try {
                frameCount++;

                // Only try pose segmentation if blazePose is initialized
                if (this.blazePose && frameCount % 5 === 0) {
                    try {
                        // Send video frame to MediaPipe Pose
                        await this.blazePose.send({ image: this.video });

                        // Results will be handled by onPoseResults callback
                    } catch (segError) {
                        console.error('Segmentation error:', segError);
                    }
                }

            } catch (error) {
                console.error('Frame processing error:', error);
                this.updateDebug(`Frame error: ${error.message}`);
            }

            this.animationId = requestAnimationFrame(processFrame);
        };

        this.isProcessing = true;
        processFrame();
    }

    stop() {
        this.isProcessing = false;
        if (this.animationId) {
            cancelAnimationFrame(this.animationId);
        }

        // Stop video stream
        if (this.video.srcObject) {
            const tracks = this.video.srcObject.getTracks();
            tracks.forEach(track => track.stop());
        }
    }
}
