import './modules/polyfillMSTP.js';
import './style.css'

import { startAppBtn, welcomeScreen, app } from './modules/domElements.js';
import { SimpleCameraManager } from './modules/simpleCamera.js';

let cameraManager = null;

// Initialize app after user clicks start button
startAppBtn.addEventListener('click', async () => {
    startAppBtn.textContent = 'Starting camera...';
    startAppBtn.disabled = true;

    try {
        // Initialize camera manager
        cameraManager = new SimpleCameraManager();

        // Initialize camera and body segmentation
        await cameraManager.initialize();

        // Hide welcome screen and show app
        welcomeScreen.style.display = 'none';
        app.style.display = 'block';

        console.log('Application started successfully');

    } catch (error) {
        console.error('Error starting application:', error);

        // Show more specific error messages
        let errorMessage = 'Failed to start camera. Try again?';
        if (error.name === 'NotAllowedError') {
            errorMessage = 'Camera access denied. Please allow camera access and try again.';
        } else if (error.name === 'NotFoundError') {
            errorMessage = 'No camera found. Please connect a camera and try again.';
        } else if (error.message.includes('BodyPix')) {
            errorMessage = 'Failed to load AI model. Please check your internet connection.';
        }

        startAppBtn.textContent = errorMessage;
        startAppBtn.disabled = false;
    }
});