// iconLoader.js

/**
 * Dynamically loads a Google Fonts stylesheet for Material Symbols Outlined,
 * constructing the URL based on an alphabetically sorted list of icon names.
 *
 * @param {string[]} iconNames - An array of icon names.
 */
export function loadIcons(iconNames) {
    // Sort the array alphabetically
    iconNames.sort();

    // Construct the base URL and the icons parameter
    const baseUrl = "https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200";
    const iconsParam = iconNames.join(',');
    const fullUrl = `${baseUrl}&icon_names=${iconsParam}`;

    // Create the link element and set its attributes
    const linkElement = document.createElement('link');
    linkElement.rel = "stylesheet";
    linkElement.href = fullUrl;

    // Append the link element to the document head
    document.head.appendChild(linkElement);
}