import { video, canvas, maskCanvas, svg, bodyPath, debugElement } from './domElements.js';
import { ContourTracer } from './contour.js';

export class CameraManager {
    constructor() {
        this.video = video;
        this.canvas = canvas;
        this.maskCanvas = maskCanvas;
        this.ctx = this.canvas.getContext('2d');
        this.maskCtx = this.maskCanvas.getContext('2d');
        this.bodyPix = null;
        this.contourTracer = new ContourTracer();
        this.isProcessing = false;
        this.animationId = null;
        this.debugElement = debugElement;
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
                    resolve();
                };
            });

            // Set canvas dimensions
            this.setupCanvas();

            this.updateDebug('Loading AI model...');
            // Initialize ML5 BodyPix
            await this.initializeBodyPix();

            this.updateDebug('Starting body tracking...');
            // Start processing
            this.startProcessing();

            this.updateDebug('Ready! Body outline will appear in green.');
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

        if (aspectRatio > windowAspectRatio) {
            this.canvas.style.width = '100vw';
            this.canvas.style.height = 'auto';
        } else {
            this.canvas.style.width = 'auto';
            this.canvas.style.height = '100vh';
        }

        // Set SVG dimensions
        svg.setAttribute('width', videoWidth);
        svg.setAttribute('height', videoHeight);
        svg.style.width = this.canvas.style.width;
        svg.style.height = this.canvas.style.height;
    }

    async initializeBodyPix() {
        try {
            console.log('Initializing BodyPix...');

            // Check if ML5 is available
            if (typeof ml5 === 'undefined') {
                throw new Error('ML5 library is not loaded');
            }

            // Wait for video to start playing
            await new Promise((resolve) => {
                if (this.video.readyState >= 2) {
                    resolve();
                } else {
                    this.video.addEventListener('loadeddata', resolve, { once: true });
                }
            });

            this.updateDebug('Creating BodyPix model...');
            this.bodyPix = await ml5.bodyPix(this.video, {
                multiplier: 0.5, // Reduced for better performance
                outputStride: 16,
                segmentationThreshold: 0.5
            });

            console.log('BodyPix initialized successfully');
            this.updateDebug('BodyPix model loaded');
        } catch (error) {
            console.error('BodyPix initialization failed:', error);
            this.updateDebug(`BodyPix error: ${error.message}`);
            throw error;
        }
    }

    startProcessing() {
        let frameCount = 0;
        const processFrame = async () => {
            if (!this.isProcessing) return;

            try {
                frameCount++;

                // Draw video frame to canvas
                this.ctx.drawImage(this.video, 0, 0, this.canvas.width, this.canvas.height);

                // Get body segmentation every few frames for performance
                if (frameCount % 3 === 0) {
                    const segmentation = await this.bodyPix.segment();

                    // Draw mask to off-screen canvas
                    this.drawMask(segmentation);

                    // Extract contours and generate SVG path
                    this.generateSVGPath(segmentation);

                    // Update debug info occasionally
                    if (frameCount % 30 === 0) {
                        this.updateDebug(`Processing frame ${frameCount}`);
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

    drawMask(segmentation) {
        // Clear mask canvas
        this.maskCtx.clearRect(0, 0, this.maskCanvas.width, this.maskCanvas.height);

        // Create ImageData for the mask
        const maskData = this.maskCtx.createImageData(this.maskCanvas.width, this.maskCanvas.height);

        // Fill mask based on segmentation
        for (let i = 0; i < segmentation.data.length; i++) {
            const pixelIndex = i * 4;
            if (segmentation.data[i] === 1) { // Person pixel
                maskData.data[pixelIndex] = 255;     // R
                maskData.data[pixelIndex + 1] = 255; // G
                maskData.data[pixelIndex + 2] = 255; // B
                maskData.data[pixelIndex + 3] = 255; // A
            } else {
                maskData.data[pixelIndex + 3] = 0;   // Transparent
            }
        }

        // Draw mask to canvas
        this.maskCtx.putImageData(maskData, 0, 0);
    }

    generateSVGPath(segmentation) {
        try {
            // Extract contours using marching squares
            const contours = this.contourTracer.extractContours(segmentation);

            // Convert contours to SVG path
            const pathData = this.contourTracer.contoursToSVGPath(contours);

            // Update SVG path
            bodyPath.setAttribute('d', pathData);
        } catch (error) {
            console.error('SVG path generation failed:', error);
        }
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
