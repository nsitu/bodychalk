import { debugElement, cameraToggle } from './domElements.js';

export class CameraManager {
    constructor() {
        this.debugElement = debugElement;
        this.stream = null;
        this.reader = null;
        this.videoWidth = 640;
        this.videoHeight = 480;
        this.currentFacingMode = 'user';
        this.isStreaming = false;
        this.hasMultipleCameras = false;
    }

    updateDebug(message) {
        if (this.debugElement) {
            this.debugElement.textContent = `Status: ${message}`;
        }
        console.log('Debug:', message);
    }

    async initialize() {
        try {
            // Check for multiple cameras and setup toggle
            await this.setupCameraToggle();

            this.updateDebug('Requesting camera access...');

            // Get user media stream
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

            // Setup SVG with correct dimensions
            this.setupSVG();

            this.updateDebug('Camera stream ready');

            // Close the first frame
            firstFrame.close();

            return {
                width: this.videoWidth,
                height: this.videoHeight,
                facingMode: this.currentFacingMode
            };
        } catch (error) {
            this.updateDebug(`Camera error: ${error.message}`);
            console.error('Camera initialization failed:', error);
            throw error;
        }
    }

    async setupCameraToggle() {
        try {
            const devices = await navigator.mediaDevices.enumerateDevices();
            const videoDevices = devices.filter(device => device.kind === 'videoinput');

            this.hasMultipleCameras = videoDevices.length > 1;

            // Show camera toggle button if multiple cameras are available
            if (this.hasMultipleCameras) {
                cameraToggle.style.display = 'block';
            } else {
                cameraToggle.style.display = 'none';
            }

            return this.hasMultipleCameras;
        } catch (error) {
            console.error('Error setting up camera toggle:', error);
            return false;
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

            // Re-setup SVG with new facing mode (handles mirroring)
            this.setupSVG();

            this.updateDebug(`Switched to ${this.currentFacingMode} camera`);

            // Return camera info for other components to use
            return {
                width: this.videoWidth,
                height: this.videoHeight,
                facingMode: this.currentFacingMode
            };

        } catch (error) {
            console.error('Camera toggle failed:', error);
            this.updateDebug(`Camera toggle failed: ${error.message}`);

            // Try to revert to previous camera
            this.currentFacingMode = this.currentFacingMode === 'user' ? 'environment' : 'user';
            throw error;
        }
    }

    async *getFrameStream() {
        this.isStreaming = true;
        let frameCount = 0;
        const targetFPS = 15; // Reduce from 30fps for better performance
        const frameInterval = Math.floor(30 / targetFPS); // Process every Nth frame

        try {
            while (this.isStreaming) {
                const { done, value: frame } = await this.reader.read();
                if (done) break;

                frameCount++;

                // Process fewer frames but more efficiently
                if (frameCount % frameInterval === 0) {
                    yield frame;
                } else {
                    frame.close();
                }
            }
        } catch (error) {
            console.error('Stream processing error:', error);
            this.updateDebug(`Stream error: ${error.message}`);
        }
    }

    stop() {
        this.isStreaming = false;

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

    getDimensions() {
        return {
            width: this.videoWidth,
            height: this.videoHeight
        };
    }

    getFacingMode() {
        return this.currentFacingMode;
    }

    hasMultipleCamerasAvailable() {
        return this.hasMultipleCameras;
    }

    setupSVG() {
        const svg = document.getElementById('svg');
        if (svg) {
            // Set SVG dimensions and viewBox
            svg.setAttribute('width', '100vw');
            svg.setAttribute('height', 'auto');
            svg.setAttribute('viewBox', `0 0 ${this.videoWidth} ${this.videoHeight}`);

            // Mirror SVG for front camera
            if (this.currentFacingMode === 'user') {
                svg.style.transform = 'translate(-50%, -50%) scaleX(-1)';
            } else {
                svg.style.transform = 'translate(-50%, -50%)';
            }
        }
    }
}
