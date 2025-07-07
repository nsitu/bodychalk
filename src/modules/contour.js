export class ContourTracer {
    constructor(options = {}) {
        this.threshold = options.threshold || 0.5;
        this.curveType = options.curveType || 'quadratic'; // 'straight' or 'quadratic'
        this.curveTension = options.curveTension || 0.5; // 0-1, affects curve smoothness
        this.removeDuplicates = options.removeDuplicates !== false; // Default to true
        this.overlapThreshold = options.overlapThreshold || 0.7; // Threshold for considering contours as pairs
    }

    extractContours(segmentation) {
        // Minimalist mode - reduced logging
        if (Math.random() < 0.05) { // Only log occasionally
            console.log('Processing segmentation...');
        }

        // Handle different segmentation formats
        let width, height, maskData;

        if (segmentation.width && segmentation.height && segmentation.data) {
            // Our custom format from BlazePose or TensorFlow.js BodyPix
            width = segmentation.width;
            height = segmentation.height;
            maskData = segmentation.data;
        } else {
            console.error('Unknown segmentation format:', segmentation);
            return [];
        }


        // Create a binary mask and check for person pixels
        const mask = new Array(width * height);
        let personPixelCount = 0;
        let backgroundPixelCount = 0;
        let otherValues = new Set();

        for (let i = 0; i < maskData.length; i++) {
            const value = maskData[i];
            otherValues.add(value);

            // Handle different mask formats:
            // - Binary masks: 0 for background, 1 for person
            // - Probability masks: 0.0-1.0 range
            if (value === 1) {
                mask[i] = 1;
                personPixelCount++;
            } else if (value === 0) {
                mask[i] = 0;
                backgroundPixelCount++;
            } else {
                // Some other value - treat anything > 0.5 as person
                mask[i] = value > 0.5 ? 1 : 0;
                if (mask[i] === 1) personPixelCount++;
                else backgroundPixelCount++;
            }
        }


        if (personPixelCount === 0) {
            return [];
        }

        // Add frame edge padding to connect edge contours
        const paddedMask = this.addFrameEdgePadding(mask, width, height);
        
        // Find contours on the padded mask
        const contours = this.findContours(paddedMask, width, height);

        // Filter and simplify contours
        const filteredContours = contours
            .filter(contour => contour.length > 10) // Remove small contours
            .map(contour => this.simplifyContour(contour, 2)); // Simplify paths

        // Remove duplicate contours (inner/outer pairs)
        const deduplicatedContours = this.removeDuplicateContours(filteredContours);

        return deduplicatedContours;
    }

    addFrameEdgePadding(mask, width, height) {
        const paddedMask = [...mask]; // Copy original mask
    
        // Add background pixels (0) around the entire frame border
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const index = y * width + x;
                
                // If pixel is on the frame edge, set it to background
                if (x === 0 || x === width - 1 || y === 0 || y === height - 1) {
                    paddedMask[index] = 0;
                }
            }
        }
    
        return paddedMask;
    }

    removeDuplicateContours(contours) {
        if (contours.length <= 1) {
            return contours;
        }

        // Calculate bounding boxes for all contours
        const boundingBoxes = contours.map(contour => this.calculateBoundingBox(contour));
        
        // Find pairs of contours with overlapping bounding boxes
        const pairs = [];
        const paired = new Set();
        
        for (let i = 0; i < contours.length; i++) {
            if (paired.has(i)) continue;
            
            for (let j = i + 1; j < contours.length; j++) {
                if (paired.has(j)) continue;
                
                const overlap = this.calculateBoundingBoxOverlap(boundingBoxes[i], boundingBoxes[j]);
                
                // Consider contours as pairs if they have significant overlap (>70%)
                if (overlap > 0.7) {
                    pairs.push([i, j]);
                    paired.add(i);
                    paired.add(j);
                    break; // Each contour can only be in one pair
                }
            }
        }
        
        // Remove one contour from each pair (keep the first one)
        const toRemove = new Set();
        pairs.forEach(([first, second]) => {
            toRemove.add(second); // Remove the second contour from each pair
        });
        
        // Remove any lone contours (contours that don't have pairs)
        for (let i = 0; i < contours.length; i++) {
            if (!paired.has(i)) {
                toRemove.add(i); // Remove lone contours
            }
        }
        
        // Log deduplication results
        if (Math.random() < 0.1) { // Log occasionally
            console.log(`Contour deduplication: ${contours.length} → ${contours.length - toRemove.size} (removed ${toRemove.size} duplicates/lone contours)`);
        }
        
        // Return contours that are not marked for removal
        return contours.filter((_, index) => !toRemove.has(index));
    }

    calculateBoundingBox(contour) {
        if (contour.length === 0) {
            return { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0, area: 0 };
        }
        
        let minX = contour[0][0];
        let minY = contour[0][1];
        let maxX = contour[0][0];
        let maxY = contour[0][1];
        
        for (let i = 1; i < contour.length; i++) {
            const [x, y] = contour[i];
            minX = Math.min(minX, x);
            minY = Math.min(minY, y);
            maxX = Math.max(maxX, x);
            maxY = Math.max(maxY, y);
        }
        
        const width = maxX - minX;
        const height = maxY - minY;
        const area = width * height;
        
        return { minX, minY, maxX, maxY, width, height, area };
    }

    calculateBoundingBoxOverlap(box1, box2) {
        // Calculate intersection area
        const intersectMinX = Math.max(box1.minX, box2.minX);
        const intersectMinY = Math.max(box1.minY, box2.minY);
        const intersectMaxX = Math.min(box1.maxX, box2.maxX);
        const intersectMaxY = Math.min(box1.maxY, box2.maxY);
        
        // No overlap if intersection is invalid
        if (intersectMinX >= intersectMaxX || intersectMinY >= intersectMaxY) {
            return 0;
        }
        
        const intersectWidth = intersectMaxX - intersectMinX;
        const intersectHeight = intersectMaxY - intersectMinY;
        const intersectArea = intersectWidth * intersectHeight;
        
        // Calculate union area
        const unionArea = box1.area + box2.area - intersectArea;
        
        // Return overlap ratio (intersection over union)
        return unionArea > 0 ? intersectArea / unionArea : 0;
    }

    findContours(mask, width, height) {
        const contours = [];
        const visited = new Array(width * height).fill(false);

        // Moore neighborhood tracing
        for (let y = 1; y < height - 1; y++) {
            for (let x = 1; x < width - 1; x++) {
                const index = y * width + x;

                if (mask[index] === 1 && !visited[index]) {
                    // Check if this is a boundary pixel
                    if (this.isBoundaryPixel(mask, width, height, x, y)) {
                        const contour = this.traceContour(mask, width, height, x, y, visited);
                        if (contour.length > 10) {
                            contours.push(contour);
                        }
                    }
                }
            }
        }

        return contours;
    }

    isBoundaryPixel(mask, width, height, x, y) {
        const index = y * width + x;
        if (mask[index] === 0) return false;

        // Check 8-connected neighbors
        const neighbors = [
            [-1, -1], [-1, 0], [-1, 1],
            [0, -1], [0, 1],
            [1, -1], [1, 0], [1, 1]
        ];

        for (const [dx, dy] of neighbors) {
            const nx = x + dx;
            const ny = y + dy;

            if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
                const neighborIndex = ny * width + nx;
                if (mask[neighborIndex] === 0) {
                    return true; // Found a background neighbor
                }
            }
        }

        return false;
    }

    traceContour(mask, width, height, startX, startY, visited) {
        const contour = [];
        const directions = [
            [1, 0], [1, 1], [0, 1], [-1, 1],
            [-1, 0], [-1, -1], [0, -1], [1, -1]
        ];

        let x = startX;
        let y = startY;
        let dir = 0;
        let steps = 0;
        const maxSteps = 5000;

        do {
            const index = y * width + x;
            visited[index] = true;
            contour.push([x, y]);

            // Find next boundary pixel
            let found = false;
            for (let i = 0; i < 8; i++) {
                const newDir = (dir + i) % 8;
                const newX = x + directions[newDir][0];
                const newY = y + directions[newDir][1];

                if (newX >= 0 && newX < width && newY >= 0 && newY < height) {
                    const newIndex = newY * width + newX;
                    if (mask[newIndex] === 1 && this.isBoundaryPixel(mask, width, height, newX, newY)) {
                        x = newX;
                        y = newY;
                        dir = (newDir + 6) % 8; // Turn left
                        found = true;
                        break;
                    }
                }
            }

            if (!found) break;
            steps++;

        } while (!(x === startX && y === startY) && steps < maxSteps);

        return contour;
    }

    simplifyContour(contour, tolerance = 1) {
        if (contour.length <= 2) return contour;

        // Douglas-Peucker algorithm for path simplification
        const simplified = [];

        const simplifyRecursive = (points, start, end, tolerance) => {
            if (end - start <= 1) return;

            let maxDistance = 0;
            let maxIndex = start;

            for (let i = start + 1; i < end; i++) {
                const distance = this.perpendicularDistance(
                    points[i],
                    points[start],
                    points[end]
                );

                if (distance > maxDistance) {
                    maxDistance = distance;
                    maxIndex = i;
                }
            }

            if (maxDistance > tolerance) {
                simplifyRecursive(points, start, maxIndex, tolerance);
                simplified.push(points[maxIndex]);
                simplifyRecursive(points, maxIndex, end, tolerance);
            }
        };

        simplified.push(contour[0]);
        simplifyRecursive(contour, 0, contour.length - 1, tolerance);
        simplified.push(contour[contour.length - 1]);

        return simplified;
    }

    perpendicularDistance(point, lineStart, lineEnd) {
        const dx = lineEnd[0] - lineStart[0];
        const dy = lineEnd[1] - lineStart[1];

        if (dx === 0 && dy === 0) {
            return Math.sqrt(
                Math.pow(point[0] - lineStart[0], 2) +
                Math.pow(point[1] - lineStart[1], 2)
            );
        }

        const t = ((point[0] - lineStart[0]) * dx + (point[1] - lineStart[1]) * dy) / (dx * dx + dy * dy);

        if (t < 0) {
            return Math.sqrt(
                Math.pow(point[0] - lineStart[0], 2) +
                Math.pow(point[1] - lineStart[1], 2)
            );
        } else if (t > 1) {
            return Math.sqrt(
                Math.pow(point[0] - lineEnd[0], 2) +
                Math.pow(point[1] - lineEnd[1], 2)
            );
        }

        const projX = lineStart[0] + t * dx;
        const projY = lineStart[1] + t * dy;

        return Math.sqrt(
            Math.pow(point[0] - projX, 2) +
            Math.pow(point[1] - projY, 2)
        );
    }

    contoursToSVGPath(contours) {
        if (!contours || contours.length === 0) {
            return '';
        }

        let pathData = '';

        contours.forEach((contour, index) => {
            if (contour.length > 0) {
                if (this.curveType === 'quadratic') {
                    pathData += this.contourToQuadraticSVGPath(contour);
                } else {
                    pathData += this.contourToStraightSVGPath(contour);
                }
            }
        });

        return pathData;
    }

    contourToStraightSVGPath(contour) {
        let pathData = `M ${contour[0][0]} ${contour[0][1]} `;
        for (let i = 1; i < contour.length; i++) {
            pathData += `L ${contour[i][0]} ${contour[i][1]} `;
        }
        pathData += 'Z ';
        return pathData;
    }

    contourToQuadraticSVGPath(contour) {
        if (contour.length < 3) {
            // Not enough points for curves, fall back to straight lines
            return this.contourToStraightSVGPath(contour);
        }

        let pathData = `M ${contour[0][0]} ${contour[0][1]} `;

        // Create smooth quadratic curves by using midpoints
        for (let i = 0; i < contour.length; i++) {
            const current = contour[i];
            const next = contour[(i + 1) % contour.length];
            const nextNext = contour[(i + 2) % contour.length];

            // Calculate midpoint between current and next
            const midX = (current[0] + next[0]) / 2;
            const midY = (current[1] + next[1]) / 2;

            // Calculate midpoint between next and next-next
            const nextMidX = (next[0] + nextNext[0]) / 2;
            const nextMidY = (next[1] + nextNext[1]) / 2;

            // Use next point as control point, next midpoint as end point
            pathData += `Q ${next[0]} ${next[1]} ${nextMidX} ${nextMidY} `;
        }

        pathData += 'Z ';
        return pathData;
    }
}
