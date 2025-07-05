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
        this.bodyPix = null;
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

            // Initialize BodyPix after camera is working
            setTimeout(() => {
                this.initializeBodyPix();
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

    async initializeBodyPix() {
        try {
            this.updateDebug('Loading AI model...');

            // Initialize TensorFlow.js BodyPix
            if (typeof bodyPix === 'undefined') {
                throw new Error('TensorFlow.js BodyPix not loaded');
            }

            console.log('Using TensorFlow.js BodyPix');

            // Initialize TensorFlow.js backend first
            if (typeof tf !== 'undefined') {
                console.log('Initializing TensorFlow.js backend...');
                await tf.ready();
                console.log('TensorFlow.js backend ready');
            }

            this.bodyPix = await bodyPix.load({
                architecture: 'MobileNetV1',
                outputStride: 16,
                multiplier: 0.5,
                quantBytes: 2
            });

            this.updateDebug('AI model loaded! Body tracking active.');
            console.log('TensorFlow.js BodyPix initialized successfully');

        } catch (error) {
            console.error('Body segmentation initialization failed:', error);
            this.updateDebug(`AI model error: ${error.message}`);
        }
    }

    drawBodyOutline(segmentation) {
        try {
            // For minimalist mode, skip the mask visualization
            // Only extract contours and draw the SVG outline

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


                // Only try body segmentation if bodyPix is initialized
                if (this.bodyPix && frameCount % 5 === 0) {
                    try {
                        // Use TensorFlow.js BodyPix API
                        const segmentation = await this.bodyPix.segmentPerson(this.video, {
                            internalResolution: 'medium',
                            segmentationThreshold: 0.3,  // Lower threshold for better detection
                            maxDetections: 1,
                            scoreThreshold: 0.3,
                            nmsRadius: 20
                        });

                        // Draw body outline if we got segmentation data
                        if (segmentation) {
                            this.drawBodyOutline(segmentation);
                        }

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
