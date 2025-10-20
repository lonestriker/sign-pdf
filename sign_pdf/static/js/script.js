/**
 * script.js - ES Module Version for CLIENT-SIDE PDF Signing + Backend Conversion
 * Frontend logic using PDF.js (rendering) and pdf-lib.js (generation).
 * High-res client-side drawing & transparency processing via Canvas.
 * Uses Python backend ONLY for the '/convert_signature' endpoint.
 */

// --- Import Required Libraries ---
import * as pdfjsLib from './pdf.mjs';

// --- Configure PDF.js Worker ---
pdfjsLib.GlobalWorkerOptions.workerSrc = './pdf.worker.mjs';

// --- Access Globally Loaded Libraries ---
const SignaturePad = window.SignaturePad;
const { PDFDocument, rgb, StandardFonts } = window.PDFLib; // pdf-lib is needed now

// --- Globals (DOM Elements) ---
// Add all elements from both versions
let tabButtons, tabContents, pdfFileInput, sigUploadArea, sigDrawArea, showUploadBtn,
    showDrawBtn, openDrawModalBtn, sigFileInput, signatureGallery, viewerContainer,
    signatureBox, signatureImage, prevPageButton, nextPageButton, pageNumSpan,
    pageCountSpan, addSigButton, generateButton, statusDiv, placedSignaturesList,
    convertSigFileInput, convertButton, convertStatusDiv, convertResultArea,
    convertedSigPreview, downloadConvertedLink, signatureModal, signaturePadCanvas,
    clearSignatureBtn, saveSignatureBtn, closeSignatureModalBtn;

// --- State Variables ---
let pdfDocProxy = null; let currentPageNum = 1; let currentScale = 1.5;
let pdfFile = null; // Original PDF File object for pdf-lib
let uploadedSignatures = []; // { id, file, dataUrl, name, isProcessed }
let activeSignatureId = null; let placedSignatures = [];
let isDragging = false; let isResizing = false; let resizeHandle = null;
let startX, startY, initialLeft, initialTop, initialWidth, initialHeight;
let renderedPageWidth = 0; let renderedPageHeight = 0; let currentCanvas = null;
let signaturePad = null;
let convertSigFile = null; let convertedBlobUrl = null; // For Convert Tab

// --- Constants ---
const STATUS_CLASSES = { info: 'text-blue-600', loading: 'text-gray-600 animate-pulse', error: 'text-red-600 font-semibold', success: 'text-green-600' };
const SIGNATURE_PAD_UPSCALE_FACTOR = 2.5;

// ==========================================================
// ========= FUNCTION DEFINITIONS ===========================
// ==========================================================

// --- Library Check ---
function checkLibraries() {
    let libsOk = true;
    if (typeof pdfjsLib === 'undefined') {
        console.error("FATAL: pdf.js not loaded!");
        setStatus("Error: PDF rendering library failed.", "error", statusDiv);
        libsOk = false;
    }
    if (typeof SignaturePad === 'undefined') {
        console.warn("SignaturePad library not loaded! Drawing unavailable.");
        if (showDrawBtn) showDrawBtn.disabled = true;
        if (openDrawModalBtn) openDrawModalBtn.disabled = true;
        // Not fatal, just disables drawing
    }
    if (typeof PDFDocument === 'undefined') {
        console.error("FATAL: pdf-lib.js not loaded!");
        setStatus("Error: PDF generation library failed.", "error", statusDiv);
        libsOk = false;
    }
    return libsOk;
}

// --- Tab Management ---
function setupTabs() {
    if (!tabButtons || tabButtons.length === 0 || !tabContents || tabContents.length === 0) {
        console.error("Tab elements not found during setup.");
        return;
    }
     // Ensure default active tab is displayed
     const activeContent = document.querySelector('.tab-content.active');
     if (activeContent) activeContent.style.display = 'block';
     tabContents.forEach(content => {
         if (!content.classList.contains('active')) { content.style.display = 'none'; }
     });

    tabButtons.forEach(button => {
        button.addEventListener('click', () => {
            const targetTab = button.dataset.tab;
            tabButtons.forEach(btn => btn.classList.remove('active'));
            button.classList.add('active');
            tabContents.forEach(content => {
                const isActive = content.id === `tab-content-${targetTab}`;
                content.style.display = isActive ? 'block' : 'none';
                if(isActive) content.classList.add('active');
                else content.classList.remove('active');
            });
        });
    });
}

// --- Signature Input Mode Toggle ---
function setupSignatureInputToggle() {
    showUploadMode(); // Default to upload mode
}

function showUploadMode() {
    if (!sigUploadArea || !sigDrawArea || !showUploadBtn || !showDrawBtn) return;
    sigUploadArea.classList.remove('hidden');
    sigDrawArea.classList.add('hidden');
    showUploadBtn.classList.add('active');
    showDrawBtn.classList.remove('active');
}

function showDrawMode() {
    if (!sigUploadArea || !sigDrawArea || !showUploadBtn || !showDrawBtn) return;
    sigUploadArea.classList.add('hidden');
    sigDrawArea.classList.remove('hidden');
    showDrawBtn.classList.add('active');
    showUploadBtn.classList.remove('active');
}

// --- Signature Pad Modal & Drawing Logic ---
function openSignatureModal() {
    if (!signatureModal) return;
    signatureModal.classList.remove('hidden');
    signatureModal.classList.add('flex');
    initializeSignaturePad();
}

function closeSignatureModal() {
     if (!signatureModal) return;
     signatureModal.classList.add('hidden');
     signatureModal.classList.remove('flex');
     if (signaturePad) {
         signaturePad.off(); // Clean up listeners
     }
}

function initializeSignaturePad() {
    if (!signaturePadCanvas || typeof SignaturePad === 'undefined') {
        console.error("Signature pad canvas or library not available.");
        setStatus("Cannot initialize signature pad.", "error", statusDiv);
        closeSignatureModal();
        return;
    }
    resizeCanvas(); // Adjust for device pixel ratio & upscale factor
    if (signaturePad) {
        signaturePad.off(); // Remove old listeners
        signaturePad.clear();
    }
    signaturePad = new SignaturePad(signaturePadCanvas, {
         backgroundColor: 'rgb(255, 255, 255)', // White background
         penColor: 'rgb(0, 0, 0)'           // Black ink
    });
    signaturePad.clear(); // Start with a clear pad
}

function resizeCanvas() {
    if (!signaturePadCanvas || !signaturePadCanvas.offsetParent) {
        // Don't resize if the canvas isn't visible (e.g., modal closed)
        return;
    }
    const ratio = Math.max(window.devicePixelRatio || 1, 1);
    const displayWidth = signaturePadCanvas.offsetWidth;
    const displayHeight = signaturePadCanvas.offsetHeight;
    const internalWidth = displayWidth * ratio * SIGNATURE_PAD_UPSCALE_FACTOR;
    const internalHeight = displayHeight * ratio * SIGNATURE_PAD_UPSCALE_FACTOR;

    // Check if dimensions actually changed to avoid unnecessary clearing
    if (signaturePadCanvas.width !== internalWidth || signaturePadCanvas.height !== internalHeight) {

        signaturePadCanvas.width = internalWidth;
        signaturePadCanvas.height = internalHeight;

        const ctx = signaturePadCanvas.getContext("2d");
        if (ctx) {
            // Scale the drawing context to match the upscaled resolution
            ctx.scale(ratio * SIGNATURE_PAD_UPSCALE_FACTOR, ratio * SIGNATURE_PAD_UPSCALE_FACTOR);
            if (signaturePad) {
                 // Data caches need to be cleared after canvas buffer size changes
                 signaturePad.clear();
            }
            console.log(`Signature pad resized to internal: ${internalWidth}x${internalHeight}`);
        } else {
            console.error("Failed to get 2D context for signature pad canvas.");
        }
    }
}

function dataURLtoFile(dataurl, filename) {
    try {
        let arr = dataurl.split(','), mimeMatch = arr[0].match(/:(.*?);/);
        if (!mimeMatch) throw new Error("Invalid Data URL format");
        let mime = mimeMatch[1], bstr = atob(arr[arr.length - 1]), n = bstr.length, u8arr = new Uint8Array(n);
        while(n--){ u8arr[n] = bstr.charCodeAt(n); }
        return new File([u8arr], filename, {type:mime});
    } catch (e) {
        console.error("Error converting Data URL to File:", e);
        setStatus("Error processing drawn signature data.", "error", statusDiv); // Show error
        return null;
    }
}

function makeBackgroundTransparent(dataUrl) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
            try {
                const canvas = document.createElement('canvas');
                canvas.width = img.naturalWidth; // Use natural dimensions
                canvas.height = img.naturalHeight;
                const ctx = canvas.getContext('2d', { willReadFrequently: true });
                if (!ctx) { throw new Error("Failed to get 2D context."); }

                ctx.drawImage(img, 0, 0);
                const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
                const data = imageData.data;
                const whiteThreshold = 250; // Pixels with R, G, and B all >= this value become transparent

                for (let i = 0; i < data.length; i += 4) {
                    const r = data[i];
                    const g = data[i + 1];
                    const b = data[i + 2];

                    // Check if the pixel is 'white enough'
                    if (r >= whiteThreshold && g >= whiteThreshold && b >= whiteThreshold) {
                        data[i + 3] = 0; // Make transparent
                    } else { // It's part of the signature (or anti-aliasing)
                        data[i] = 0;     // Force Black
                        data[i + 1] = 0;
                        data[i + 2] = 0;
                        data[i + 3] = 255; // Make Opaque
                    }
                }
                ctx.putImageData(imageData, 0, 0);
                resolve(canvas.toDataURL('image/png')); // Always return PNG for transparency
            } catch (error) {
                 console.error("Transparency processing error:", error);
                 reject(new Error("Failed to process signature transparency."));
            }
        };
        img.onerror = (error) => {
            console.error("Image load error for transparency:", error);
            reject(new Error("Failed to load signature image for processing."));
        };
        img.src = dataUrl;
    });
}

async function saveDrawnSignature() {
    if (!signaturePad || signaturePad.isEmpty()) {
        alert("Please provide a signature first.");
        return;
    }
    setStatus('Processing drawn signature...', 'loading', statusDiv);
    try {
        const originalDataURL = signaturePad.toDataURL('image/png'); // Get high-res base image
        const transparentDataURL = await makeBackgroundTransparent(originalDataURL); // Process for transparency
        const timestamp = Date.now();
        const filename = `signature_drawn_${timestamp}.png`;
        const signatureFileObject = dataURLtoFile(transparentDataURL, filename); // Convert processed PNG data to File
        if (!signatureFileObject) return; // Error handled in dataURLtoFile

        // Add to the uploadedSignatures array
        const signatureData = {
            id: `sig_${timestamp}_d`, // Indicate drawn
            file: signatureFileObject,
            dataUrl: transparentDataURL,
            name: filename,
            isProcessed: true // Mark as processed since we did it client-side
        };
        uploadedSignatures.push(signatureData);
        renderSignatureGallery(); // Update the UI gallery
        setActiveSignature(signatureData.id); // Select the new signature
        setStatus('Drawn signature saved.', 'success', statusDiv);
        closeSignatureModal(); // Close the modal on success
    } catch (error) {
        console.error("Error saving drawn signature:", error);
        setStatus(`Save failed: ${error.message || error}`, "error", statusDiv);
    }
}

// --- PDF Loading & Rendering (using PDF.js) ---
function handlePdfUpload(event) {
    const file = event.target.files[0];
    if (file && file.type === 'application/pdf') {
        pdfFile = file; // Store File obj for pdf-lib
        const reader = new FileReader();
        reader.onload = function(e) {
            setStatus('Loading PDF...', 'loading', statusDiv);
            // Use imported pdfjsLib
            const loadingTask = pdfjsLib.getDocument({ data: e.target.result });
            loadingTask.promise.then(doc => {
                pdfDocProxy = doc;
                if(pageCountSpan) pageCountSpan.textContent = pdfDocProxy.numPages;
                else console.warn("pageCountSpan element not found");
                currentPageNum = 1;
                placedSignatures = []; // Clear placements for new PDF
                renderPlacedSignaturesList();
                clearPersistentPlacements(); // Clear visual divs
                renderPage(currentPageNum); // Render first page
                setStatus('PDF loaded.', 'success', statusDiv);
            }).catch(err => {
                console.error("PDF Load Error:", err);
                setStatus(`PDF Load Failed: ${err.message || err}`, 'error', statusDiv);
                resetPdfState();
            });
        };
        reader.readAsArrayBuffer(file); // pdf-lib needs ArrayBuffer
    } else {
        setStatus('Please select a valid PDF file.', 'error', statusDiv);
        resetPdfState();
        pdfFile = null;
    }
    updateButtonStates();
}

function renderPage(num) {
    if (!pdfDocProxy || !viewerContainer) return;
    setStatus('Rendering page...', 'loading', statusDiv);
    if(signatureBox) signatureBox.classList.add('hidden'); // Hide active placement box
    clearPersistentPlacements(); // Clear previously placed visual divs

    pdfDocProxy.getPage(num).then(page => {
        const viewport = page.getViewport({ scale: currentScale });
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        if (!context) {
            handleRenderError(new Error("Failed to get 2D context for PDF page"), num);
            return;
        }
        canvas.height = viewport.height;
        canvas.width = viewport.width;
        canvas.className = "block mx-auto shadow-md"; // Style the canvas

        // Store dimensions for placement calculations
        renderedPageWidth = viewport.width;
        renderedPageHeight = viewport.height;

        // Replace previous canvas if exists
        const existingCanvas = viewerContainer.querySelector('canvas');
        if (existingCanvas) existingCanvas.remove();
        // Insert canvas before the active signature box
        viewerContainer.insertBefore(canvas, signatureBox);
        currentCanvas = canvas; // Update current canvas reference

        const renderContext = { canvasContext: context, viewport: viewport };
        page.render(renderContext).promise.then(() => {
            if (pageNumSpan) pageNumSpan.textContent = num; // Update page number display
            setStatus('Page rendered.', 'success', statusDiv);
            updatePageControls(); // Update prev/next button states
            renderPersistentPlacementsForPage(num - 1); // Re-render persistent signatures for this page
            if (activeSignatureId && signatureBox) {
                signatureBox.classList.remove('hidden'); // Show active box if a signature is selected
                keepSignatureInBounds(signatureBox); // Ensure it's within bounds initially
            }
        }).catch(err => handleRenderError(err, num));
    }).catch(err => handleRenderError(err, num));
}

// --- Signature Upload (File Input) & Gallery ---
function handleSignatureUpload(event) {
    const file = event.target.files[0];
    if (file && file.type.startsWith('image/')) {
        const reader = new FileReader();
        reader.onload = function(e) {
            const isPng = file.type === 'image/png';
            // Store data, mark PNGs as potentially processed, others need conversion
            const signatureData = {
                id: `sig_${Date.now()}_u`, // Indicate uploaded
                file: file,
                dataUrl: e.target.result,
                name: file.name,
                isProcessed: isPng
            };
            uploadedSignatures.push(signatureData);
            renderSignatureGallery();
            setActiveSignature(signatureData.id);
            setStatus('Signature uploaded.', 'success', statusDiv);
            if (!isPng) {
                setStatus('Signature uploaded. Hover over it in the gallery for transparency option.', 'info', statusDiv);
            }
        }
        reader.readAsDataURL(file);
        event.target.value = null; // Allow re-uploading same file
    } else {
        setStatus('Please select a valid image file (PNG, JPG, GIF).', 'error', statusDiv);
    }
    updateButtonStates();
}

// --- ENHANCED: Signature Gallery Rendering with Optional Processing Button ---
function renderSignatureGallery() {
    if (!signatureGallery) return;
    signatureGallery.innerHTML = ''; // Clear gallery
    if (uploadedSignatures.length === 0) {
        signatureGallery.innerHTML = '<span class="text-xs text-gray-500 italic">Signatures added via Upload or Draw will appear here.</span>';
        return;
    }

    uploadedSignatures.forEach(sig => {
        const itemDiv = document.createElement('div');
        itemDiv.className = 'sig-gallery-item'; // Wrapper for relative positioning

        const img = document.createElement('img');
        img.src = sig.dataUrl;
        img.alt = `Preview: ${sig.name}`;
        img.title = sig.name;
        img.dataset.signatureId = sig.id;
        img.className = `h-12 md:h-16 object-contain border-2 border-transparent rounded hover:border-gray-400`;
        if (sig.id === activeSignatureId) {
            img.classList.add('active-signature'); // Highlight active one
        }

        itemDiv.appendChild(img);

        // Add 'Make Transparent' button ONLY if not already processed
        if (!sig.isProcessed) {
            const processBtn = document.createElement('button');
            processBtn.textContent = '✨'; // Magic wand icon
            processBtn.title = 'Make background transparent (uses server)';
            processBtn.dataset.signatureId = sig.id;
            // Add 'needs-conversion' class to control visibility via CSS hover rule
            processBtn.className = 'make-transparent-btn needs-conversion';
            itemDiv.appendChild(processBtn);
        }

        signatureGallery.appendChild(itemDiv);
    });
}

// --- NEW: Handler for Gallery Event Delegation ---
function handleGalleryAction(event) {
    const target = event.target;
    // Handle clicking the image to select it
    if (target.tagName === 'IMG' && target.dataset.signatureId) {
        setActiveSignature(target.dataset.signatureId);
    }
    // Handle clicking the 'Make Transparent' button
    else if (target.classList.contains('make-transparent-btn') && target.dataset.signatureId) {
        const signatureId = target.dataset.signatureId;
        setStatus(`Processing transparency for ${signatureId}...`, 'loading', statusDiv);
        target.disabled = true; // Disable button while processing
        target.textContent = '⏳'; // Loading indicator
        processUploadedSignature(signatureId)
          .catch(err => { // Handle errors from processing
              console.error("Processing error caught in handler:", err);
              setStatus(err.message || 'Failed to process transparency.', 'error', statusDiv);
              // Optionally re-enable button on error, but gallery re-render might handle it
              // target.disabled = false;
              // target.textContent = '✨';
          })
          .finally(() => {
              // Gallery will be re-rendered on success in processUploadedSignature,
              // so no explicit re-enable needed here usually.
          });
    }
}

// --- NEW: Function to Process Uploaded Signature via Backend ---
async function processUploadedSignature(signatureId) {
    const sigIndex = uploadedSignatures.findIndex(s => s.id === signatureId);
    if (sigIndex === -1) {
        throw new Error('Signature not found for processing.');
    }
    const sigData = uploadedSignatures[sigIndex];

    if (!sigData.file) {
        throw new Error('Original file data missing for processing.');
    }

    const formData = new FormData();
    formData.append('signatureFile', sigData.file);

    try {
        const response = await fetch('/convert_signature', { method: 'POST', body: formData });

        if (!response.ok) {
            let errorMsg = `Server conversion failed: ${response.status}`;
            try {
                const errData = await response.json();
                errorMsg = errData?.error?.message || errorMsg;
            } catch (e) { /* ignore JSON parsing error, use status text */ }
            throw new Error(errorMsg);
        }

        const contentType = response.headers.get('content-type');
        if (!contentType || !contentType.startsWith('image/png')) {
            throw new Error('Server did not return a PNG image.');
        }

        const processedBlob = await response.blob();

        // Create a new File object for the processed data
        const processedFileName = sigData.name.replace(/\.[^.]+$/, '_transparent.png'); // Create new name
        const processedFile = new File([processedBlob], processedFileName, { type: 'image/png' });

        // Read the processed blob as a Data URL for the preview
        const reader = new FileReader();
        const dataUrlPromise = new Promise((resolve, reject) => {
            reader.onload = () => resolve(reader.result);
            reader.onerror = reject;
        });
        reader.readAsDataURL(processedBlob);
        const processedDataUrl = await dataUrlPromise;

        // Update the signature data in the main array
        uploadedSignatures[sigIndex] = {
            ...sigData, // Keep original ID
            file: processedFile,        // Use new File object
            dataUrl: processedDataUrl,  // Use new Data URL
            name: processedFileName,    // Use new name
            isProcessed: true           // Mark as processed!
        };

        renderSignatureGallery(); // Re-render the gallery to show updated preview and remove button

        // If this was the active signature, update the main placement box preview
        if (activeSignatureId === signatureId && signatureImage) {
            signatureImage.src = processedDataUrl;
        }
        setStatus(`Transparency applied to ${processedFileName}`, 'success', statusDiv);

    } catch (error) {
        console.error('Error processing uploaded signature:', error);
        // Re-throw the error so the caller UI can be updated
        throw error;
    }
}

function setActiveSignature(signatureId) {
    activeSignatureId = signatureId;
    const activeSigData = uploadedSignatures.find(s => s.id === signatureId);
    if (activeSigData && signatureBox && signatureImage) {
        signatureImage.src = activeSigData.dataUrl;
        signatureBox.classList.remove('hidden');
        // Reset position/size for the newly activated signature
        signatureBox.style.left = '10px';
        signatureBox.style.top = '10px';
        signatureBox.style.width = '150px';
        signatureBox.style.height = 'auto'; // Let aspect ratio determine initial height
        // Adjust height based on image aspect ratio after it potentially loads/renders
        requestAnimationFrame(() => { // Defer calculation slightly
            const imgElement = signatureImage; // Direct reference
            const intrinsicWidth = imgElement.naturalWidth;
            const intrinsicHeight = imgElement.naturalHeight;
            const currentWidth = signatureBox.offsetWidth;

            if (intrinsicWidth > 0 && intrinsicHeight > 0 && currentWidth > 0) {
                const aspectRatio = intrinsicHeight / intrinsicWidth;
                const calculatedHeight = currentWidth * aspectRatio;
                signatureBox.style.height = `${Math.max(20, calculatedHeight)}px`; // Ensure min height
            } else {
                 // Fallback if image dimensions aren't available yet or width is zero
                 signatureBox.style.height = '75px';
            }

            if (currentCanvas) keepSignatureInBounds(signatureBox); // Ensure it's within bounds
        });
    } else {
        // Deactivate if no valid signature found or elements missing
        activeSignatureId = null;
        if(signatureImage) signatureImage.src = '#';
        if(signatureBox) signatureBox.classList.add('hidden');
    }
    renderSignatureGallery(); // Update gallery highlight
    updateButtonStates();
}

// --- UI / State Management Helpers ---
function handleRenderError(err, pageNum) {
    console.error(`Error rendering page ${pageNum}:`, err);
    setStatus(`Error rendering page ${pageNum}: ${err.message || err}`, 'error', statusDiv);
    updatePageControls();
}

function renderPersistentPlacementsForPage(pageNumZeroBased) {
    placedSignatures.filter(p => p.pageNum === pageNumZeroBased).forEach(renderSinglePersistentPlacement);
}

function clearPersistentPlacements() {
    if (viewerContainer) {
        viewerContainer.querySelectorAll('.persistent-placement').forEach(el => el.remove());
    }
}

function updatePageControls() {
    if (!pdfDocProxy || !prevPageButton || !nextPageButton) return;
    prevPageButton.disabled = (currentPageNum <= 1);
    nextPageButton.disabled = (currentPageNum >= pdfDocProxy.numPages);
}

function goToPrevPage() {
    if (currentPageNum > 1) {
        currentPageNum--;
        renderPage(currentPageNum);
    }
}

function goToNextPage() {
    if (pdfDocProxy && currentPageNum < pdfDocProxy.numPages) {
        currentPageNum++;
        renderPage(currentPageNum);
    }
}

function updateButtonStates() {
    if (addSigButton) addSigButton.disabled = !(pdfDocProxy && activeSignatureId && currentCanvas);
    if (generateButton) generateButton.disabled = !(pdfDocProxy && placedSignatures.length > 0);
    if (convertButton) convertButton.disabled = !convertSigFile; // Convert tab button state
}

function resetPdfState() {
    pdfDocProxy = null;
    currentPageNum = 1;
    if(pageNumSpan) pageNumSpan.textContent = '0';
    if(pageCountSpan) pageCountSpan.textContent = '0';
    if(viewerContainer) {
        const c = viewerContainer.querySelector('canvas');
        if (c) c.remove();
    }
    clearPersistentPlacements();
    if(signatureBox) signatureBox.classList.add('hidden');
    updatePageControls();
    renderedPageWidth = 0;
    renderedPageHeight = 0;
    currentCanvas = null;
    pdfFile = null;
    placedSignatures = [];
    renderPlacedSignaturesList();
    // Keep uploaded signatures unless explicitly cleared by user action (optional)
    // uploadedSignatures = [];
    activeSignatureId = null;
    renderSignatureGallery(); // Reflect cleared active state
    updateButtonStates();
}

function setStatus(message, type = 'info', targetDiv = statusDiv) {
   if (!targetDiv) {
       console.error(`setStatus targetDiv is invalid for message: "${message}"`);
       return;
   }
   targetDiv.textContent = message;
   Object.values(STATUS_CLASSES).forEach(cls => targetDiv.classList.remove(...cls.split(' ')));
   if (STATUS_CLASSES[type]) {
       targetDiv.classList.add(...STATUS_CLASSES[type].split(' '));
   }
}

// --- Drag and Resize Logic ---
function startDragOrResize(e) {
    if (!activeSignatureId || !pdfDocProxy || !currentCanvas) return;
    startX = e.clientX; startY = e.clientY;
    initialLeft = signatureBox.offsetLeft; initialTop = signatureBox.offsetTop;
    initialWidth = signatureBox.offsetWidth; initialHeight = signatureBox.offsetHeight;
    document.body.style.userSelect = 'none';
    if (e.target.classList.contains('resize-handle')) {
        isResizing = true; resizeHandle = e.target;
    } else if (e.target === signatureBox || e.target === signatureImage) {
        isDragging = true; signatureBox.style.cursor = 'grabbing';
    }
}

function handleMouseMove(e) {
    if (!isDragging && !isResizing) return;
    e.preventDefault();
    const dx = e.clientX - startX; const dy = e.clientY - startY;
    if (isDragging) {
        dragSignature(dx, dy);
    } else if (isResizing) {
        resizeSignature(dx, dy);
    }
}

function handleMouseUp(e) {
    let wasActive = isDragging || isResizing;
    if (isDragging) {
        isDragging = false;
        if(signatureBox) signatureBox.style.cursor = 'move';
    }
    if (isResizing) {
        isResizing = false;
        resizeHandle = null;
    }
    if (wasActive && currentCanvas) {
        keepSignatureInBounds(signatureBox);
    }
    document.body.style.userSelect = '';
}

function dragSignature(dx, dy) {
    if(!signatureBox) return;
    let newLeft = initialLeft + dx;
    let newTop = initialTop + dy;
    signatureBox.style.left = `${newLeft}px`;
    signatureBox.style.top = `${newTop}px`;
    // Bounds check on mouse up
}

function resizeSignature(dx, dy) {
    if(!signatureBox || !resizeHandle) return;
    let newLeft = initialLeft; let newTop = initialTop;
    let newWidth = initialWidth; let newHeight = initialHeight;
    const handleClassList = resizeHandle.classList;
    if (handleClassList.contains('cursor-nwse-resize')) { // Bottom-right or Top-left
        if (handleClassList.contains('-bottom-[6px]')) { // Bottom-right
             newWidth = initialWidth + dx; newHeight = initialHeight + dy;
        } else { // Top-left
             newWidth = initialWidth - dx; newHeight = initialHeight - dy; newLeft = initialLeft + dx; newTop = initialTop + dy;
        }
    } else if (handleClassList.contains('cursor-nesw-resize')) { // Bottom-left or Top-right
       if (handleClassList.contains('-bottom-[6px]')) { // Bottom-left
            newWidth = initialWidth - dx; newHeight = initialHeight + dy; newLeft = initialLeft + dx;
       } else { // Top-right
            newWidth = initialWidth + dx; newHeight = initialHeight - dy; newTop = initialTop + dy;
       }
    }
    const minSize = 20;
    if (newWidth < minSize) { newWidth = minSize; if (handleClassList.contains('-left-[6px]')) newLeft = initialLeft + initialWidth - minSize; }
    if (newHeight < minSize) { newHeight = minSize; if (handleClassList.contains('-top-[6px]')) newTop = initialTop + initialHeight - minSize; }
    signatureBox.style.left = `${newLeft}px`; signatureBox.style.top = `${newTop}px`;
    signatureBox.style.width = `${newWidth}px`; signatureBox.style.height = `${newHeight}px`;
    // Bounds check on mouse up
}

function keepSignatureInBounds(element) {
    if (!currentCanvas || !element) return;
    // Use offsetLeft/Top relative to the viewer parent
    let currentX = element.offsetLeft;
    let currentY = element.offsetTop;
    let currentWidth = element.offsetWidth;
    let currentHeight = element.offsetHeight;

    // Max positions based on RENDERED canvas dimensions
    const maxLeft = renderedPageWidth - currentWidth;
    const maxTop = renderedPageHeight - currentHeight;

    // Constrain position
    currentX = Math.max(0, Math.min(currentX, maxLeft));
    currentY = Math.max(0, Math.min(currentY, maxTop));

    // Constrain size (ensure it fits within the bounds from the constrained position)
    currentWidth = Math.min(currentWidth, renderedPageWidth - currentX);
    currentHeight = Math.min(currentHeight, renderedPageHeight - currentY);

    // Apply constrained values
    element.style.left = `${currentX}px`;
    element.style.top = `${currentY}px`;
    element.style.width = `${currentWidth}px`;
    element.style.height = `${currentHeight}px`;
}

// --- Placement Management ---
function addPlacement() {
    if (!pdfDocProxy || !activeSignatureId || !currentCanvas || !signatureBox) {
        setStatus('Cannot add signature. PDF loaded, signature selected, and page rendered?', 'error', statusDiv);
        return;
    }
    // Use offsetLeft/Top for position relative to viewer parent
    const finalX = Math.max(0, signatureBox.offsetLeft);
    const finalY = Math.max(0, signatureBox.offsetTop);
    const sigWidth = signatureBox.offsetWidth;
    const sigHeight = signatureBox.offsetHeight;

    // Ensure width/height fit within canvas from the final position
    const finalWidth = Math.min(sigWidth, renderedPageWidth - finalX);
    const finalHeight = Math.min(sigHeight, renderedPageHeight - finalY);

    const placementData = {
        placementId: `place_${Date.now()}_${Math.random().toString(16).slice(2)}`,
        signatureId: activeSignatureId,
        pageNum: currentPageNum - 1, // 0-based index
        x: finalX,
        y: finalY,
        widthPx: finalWidth,
        heightPx: finalHeight,
    };

    // Visually update the ACTIVE box to reflect potential constraint adjustments
    signatureBox.style.left = `${finalX}px`;
    signatureBox.style.top = `${finalY}px`;
    signatureBox.style.width = `${finalWidth}px`;
    signatureBox.style.height = `${finalHeight}px`;

    placedSignatures.push(placementData);
    renderSinglePersistentPlacement(placementData); // Add static visual representation
    renderPlacedSignaturesList(); // Update summary list
    setStatus(`Signature added to page ${currentPageNum}.`, 'success', statusDiv);
    updateButtonStates();
    // Optional: Deselect signature after placing
    // setActiveSignature(null);
}

function renderSinglePersistentPlacement(placementData) {
     if (!viewerContainer) return;
     const sigData = uploadedSignatures.find(s => s.id === placementData.signatureId);
     if (!sigData) return; // Need the signature data for the image src

     const placementDiv = document.createElement('div');
     placementDiv.className = 'persistent-placement absolute border border-gray-400 border-dashed z-5 pointer-events-none'; // Tailwind styles
     placementDiv.style.left = `${placementData.x}px`;
     placementDiv.style.top = `${placementData.y}px`;
     placementDiv.style.width = `${placementData.widthPx}px`;
     placementDiv.style.height = `${placementData.heightPx}px`;
     placementDiv.dataset.placementId = placementData.placementId; // Link visual element to data

     const placementImg = document.createElement('img');
     placementImg.src = sigData.dataUrl;
     placementImg.className = 'w-full h-full object-contain opacity-70'; // Ensure image scales within div, slightly transparent

     placementDiv.appendChild(placementImg);
     viewerContainer.appendChild(placementDiv); // Add to the main viewer div
}

function renderPlacedSignaturesList() {
    if (!placedSignaturesList) return;
    placedSignaturesList.innerHTML = ''; // Clear current list
    if (placedSignatures.length === 0) {
        placedSignaturesList.innerHTML = '<li class="text-gray-500 italic">No signatures added yet.</li>';
    } else {
        placedSignatures.forEach(p => {
            const sigInfo = uploadedSignatures.find(s => s.id === p.signatureId);
            // Use the name property, shorten if needed
            const sigName = sigInfo ? (sigInfo.name || `ID: ${p.signatureId.substring(0, 8)}...`) : `ID: ${p.signatureId.substring(0, 8)}...`;
            const displayName = sigName.length > 20 ? sigName.substring(0, 17) + '...' : sigName;

            const li = document.createElement('li');
            li.className = "flex justify-between items-center text-xs p-1 bg-gray-50 rounded"; // List item style

            const textSpan = document.createElement('span');
            textSpan.textContent = `Sig: ${displayName} on Page ${p.pageNum + 1}`; // Show 1-based page number
            li.appendChild(textSpan);

            const removeBtn = document.createElement('button');
            removeBtn.textContent = 'Remove';
            removeBtn.dataset.placementId = p.placementId; // Link button to placement ID
            removeBtn.className = "ml-2 px-1 py-0.5 text-red-600 border border-red-500 rounded text-[10px] hover:bg-red-50 focus:outline-none focus:ring-1 focus:ring-red-300"; // Remove button style
            li.appendChild(removeBtn);

            placedSignaturesList.appendChild(li);
        });
    }
     updateButtonStates(); // Update generate button availability
}

function handleRemovePlacement(event) {
    if (event.target.tagName === 'BUTTON' && event.target.dataset.placementId) {
        const placementIdToRemove = event.target.dataset.placementId;
        // Remove the visual element from the viewer
        if(viewerContainer) {
            const persistentElement = viewerContainer.querySelector(`.persistent-placement[data-placement-id="${placementIdToRemove}"]`);
            if (persistentElement) persistentElement.remove();
        }
        // Remove the data from the array
        placedSignatures = placedSignatures.filter(p => p.placementId !== placementIdToRemove);
        renderPlacedSignaturesList(); // Update the text list
        setStatus('Signature placement removed.', 'info', statusDiv);
        updateButtonStates();
    }
}

// --- Convert Signature Tab Logic (Uses Backend) ---
function handleConvertSigFileSelect(event) {
    const file = event.target.files[0];
    if (file && file.type.startsWith('image/')) {
        convertSigFile = file;
        if(convertButton) convertButton.disabled = false;
        setStatus('File selected. Click Convert.', 'info', convertStatusDiv);
        if(convertResultArea) convertResultArea.classList.add('hidden'); // Hide old result
    } else {
        convertSigFile = null;
        if(convertButton) convertButton.disabled = true;
        setStatus('Please select a valid image file (PNG, JPG, GIF).', 'error', convertStatusDiv);
        if(convertResultArea) convertResultArea.classList.add('hidden');
    }
}

function handleConvertSignature() {
     if (!convertSigFile) {
         setStatus('No signature file selected for conversion.', 'error', convertStatusDiv);
         return;
     }
     setStatus('Converting signature on server...', 'loading', convertStatusDiv);
     if(convertButton) convertButton.disabled = true;
     if(convertResultArea) convertResultArea.classList.add('hidden');
     if (convertedBlobUrl) {
         URL.revokeObjectURL(convertedBlobUrl); // Clean up previous blob URL
         convertedBlobUrl = null;
     }

     const formData = new FormData();
     formData.append('signatureFile', convertSigFile);

     fetch('/convert_signature', { method: 'POST', body: formData })
         .then(async response => { // Async to handle potential JSON error
             if (!response.ok) {
                let errorMsg = `Conversion failed: ${response.status} ${response.statusText}`;
                try {
                    const errData = await response.json();
                    errorMsg = errData?.error?.message || errorMsg;
                } catch (e) { /* Ignore JSON parsing error */ }
                throw new Error(errorMsg);
             }
             // Check content type to be sure we got an image back
             const contentType = response.headers.get('content-type');
             if (!contentType || !contentType.startsWith('image/')) {
                // Try to get text error message if server sent one
                let textError = await response.text();
                throw new Error(textError || 'Server did not return an image file.');
             }
             return response.blob();
         })
         .then(blob => {
             convertedBlobUrl = URL.createObjectURL(blob); // Create object URL for the processed image blob
             if(convertedSigPreview) convertedSigPreview.src = convertedBlobUrl;
             if(downloadConvertedLink) {
                 downloadConvertedLink.href = convertedBlobUrl;
                 // Try to set a better download name based on original file
                 downloadConvertedLink.download = convertSigFile.name.replace(/\.[^.]+$/, '_transparent.png');
             }
             if(convertResultArea) convertResultArea.classList.remove('hidden');
             setStatus('Conversion successful. Preview shown below.', 'success', convertStatusDiv);
             // Keep button disabled until a new file is selected
         })
         .catch(error => {
             console.error('Conversion error:', error);
             setStatus(`${error.message || 'Unknown conversion error'}`, 'error', convertStatusDiv);
             if(convertResultArea) convertResultArea.classList.add('hidden');
              // Re-enable button on error ONLY if a file is still selected
             if(convertButton && convertSigFile) {
                 convertButton.disabled = false;
             }
         });
 }


// --- *** PDF GENERATION (CLIENT-SIDE using pdf-lib.js) *** ---
function readFileAsArrayBuffer(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = (error) => reject(error);
        reader.readAsArrayBuffer(file);
    });
}

async function generateSignedPdfClientSide() {
    if (!pdfFile || placedSignatures.length === 0) {
        setStatus('Please load PDF and add signatures.', 'error');
        return;
    }
    if (renderedPageWidth <= 0 || renderedPageHeight <= 0) {
        setStatus('Error: Page dimensions missing. Render a page first.', 'error');
        return;
    }

    setStatus('Processing PDF in browser...', 'loading');
    generateButton.disabled = true;

    try {
        // 1. Read the original PDF into an ArrayBuffer
        const pdfBytes = await readFileAsArrayBuffer(pdfFile);

        // 2. Load the PDF document with pdf-lib
        const pdfDoc = await PDFDocument.load(pdfBytes);
        const pages = pdfDoc.getPages();

        // Analyze page rotations
        const rotations = pages.map(p => (p.getRotation()?.angle || 0) % 360);
        const rotatedIndices = rotations
            .map((angle, idx) => ({ angle, idx }))
            .filter(x => x.angle !== 0)
            .map(x => x.idx);
        console.log(`Rotation analysis: ${pages.length} pages, rotated: [${rotatedIndices.join(', ')}]`);

        if (rotatedIndices.length === 0) {
            // Fast path: no rotation, keep original vector stamping on the source PDF
            const uniqueSignatureIds = [...new Set(placedSignatures.map(p => p.signatureId))];
            const embeddedSignatures = {};
            for (const sigId of uniqueSignatureIds) {
                const sigData = uploadedSignatures.find(s => s.id === sigId);
                if (!sigData || !sigData.file) {
                    throw new Error(`Signature file missing for ID: ${sigId}`);
                }
                if (!sigData.isProcessed && sigData.file.type !== 'image/png') {
                    console.warn(`Signature ${sigData.name} was not processed for transparency. Embedding original.`);
                }
                const sigBytes = await readFileAsArrayBuffer(sigData.file);
                let embeddedImage;
                const fileType = sigData.file.type;
                if (fileType === 'image/png') {
                    embeddedImage = await pdfDoc.embedPng(sigBytes);
                } else if (fileType === 'image/jpeg') {
                    embeddedImage = await pdfDoc.embedJpg(sigBytes);
                } else {
                    console.warn(`Unsupported type ${fileType} for ${sigData.name}. Attempting PNG embed (may fail).`);
                    try { embeddedImage = await pdfDoc.embedPng(sigBytes); }
                    catch { throw new Error(`Cannot embed unsupported type: ${fileType}. Please use PNG/JPG or process first.`); }
                }
                embeddedSignatures[sigId] = embeddedImage;
            }

            for (const placement of placedSignatures) {
                if (placement.pageNum < 0 || placement.pageNum >= pages.length) {
                    console.warn(`Skipping placement for invalid page number: ${placement.pageNum}`);
                    continue;
                }
                const page = pages[placement.pageNum];
                const { width: pageWidthPt, height: pageHeightPt } = page.getSize();
                const image = embeddedSignatures[placement.signatureId];
                if (!image) continue;
                const scaleX = pageWidthPt / renderedPageWidth;
                const scaleY = pageHeightPt / renderedPageHeight;
                const sigWidthPt = placement.widthPx * scaleX;
                const sigHeightPt = placement.heightPx * scaleY;
                const pdfX = placement.x * scaleX;
                const pdfY = pageHeightPt - (placement.y * scaleY) - sigHeightPt;
                page.drawImage(image, { x: pdfX, y: pdfY, width: sigWidthPt, height: sigHeightPt });
            }

            const modifiedPdfBytes = await pdfDoc.save();
            const blob = new Blob([modifiedPdfBytes], { type: 'application/pdf' });
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.style.display = 'none'; a.href = url;
            a.download = `${pdfFile.name.replace(/\.pdf$/i, '')}_signed_clientside.pdf`;
            document.body.appendChild(a); a.click();
            window.URL.revokeObjectURL(url); document.body.removeChild(a);
            setStatus('Signed PDF generated successfully!', 'success');
            return; // done
        }

        // Mixed path: some pages rotated. Copy unrotated pages as vectors; rasterize only rotated pages upright.
        if (!pdfDocProxy) {
            throw new Error('PDF renderer not initialized. Please reload the PDF.');
        }
        console.log('Mixed path: rasterizing rotated pages only; copying unrotated pages as vectors.');

        const outDoc = await PDFDocument.create();
        for (let i = 0; i < pages.length; i++) {
            const angle = rotations[i];
            if (angle === 0) {
                const [copied] = await outDoc.copyPages(pdfDoc, [i]);
                outDoc.addPage(copied);
            } else {
                const srcPage = pages[i];
                const { width: pageWidthPt, height: pageHeightPt } = srcPage.getSize();
                const needsSwap = angle === 90 || angle === 270;
                const normWidthPt = needsSwap ? pageHeightPt : pageWidthPt;
                const normHeightPt = needsSwap ? pageWidthPt : pageHeightPt;

                const pdfjsPage = await pdfDocProxy.getPage(i + 1);
                const RASTER_SCALE = 2.0;
                const viewport = pdfjsPage.getViewport({ scale: RASTER_SCALE });
                const offCanvas = document.createElement('canvas');
                const ctx = offCanvas.getContext('2d');
                if (!ctx) throw new Error('Failed to get 2D context for offscreen render.');
                offCanvas.width = viewport.width;
                offCanvas.height = viewport.height;
                await pdfjsPage.render({ canvasContext: ctx, viewport }).promise;

                const dataUrl = offCanvas.toDataURL('image/png');
                const pngBytes = dataURLtoUint8Array(dataUrl);
                const embeddedPng = await outDoc.embedPng(pngBytes);
                const newPage = outDoc.addPage([normWidthPt, normHeightPt]);
                newPage.drawImage(embeddedPng, { x: 0, y: 0, width: normWidthPt, height: normHeightPt });
            }
        }

        // Embed signatures into outDoc
        const uniqueSignatureIds = [...new Set(placedSignatures.map(p => p.signatureId))];
        const embeddedSignatures = {};
        for (const sigId of uniqueSignatureIds) {
            const sigData = uploadedSignatures.find(s => s.id === sigId);
            if (!sigData || !sigData.file) {
                throw new Error(`Signature file missing for ID: ${sigId}`);
            }
            const sigBytes = await readFileAsArrayBuffer(sigData.file);
            let embeddedImage;
            const fileType = sigData.file.type;
            if (fileType === 'image/png') {
                embeddedImage = await outDoc.embedPng(sigBytes);
            } else if (fileType === 'image/jpeg') {
                embeddedImage = await outDoc.embedJpg(sigBytes);
            } else {
                console.warn(`Unsupported type ${fileType} for ${sigData.name}. Attempting PNG embed (may fail).`);
                try { embeddedImage = await outDoc.embedPng(sigBytes); }
                catch { throw new Error(`Cannot embed unsupported type: ${fileType}. Please use PNG/JPG or process first.`); }
            }
            embeddedSignatures[sigId] = embeddedImage;
        }

        // Stamp signatures on outDoc with original mapping
        for (const placement of placedSignatures) {
            if (placement.pageNum < 0 || placement.pageNum >= outDoc.getPageCount()) {
                console.warn(`Skipping placement for invalid page number: ${placement.pageNum}`);
                continue;
            }
            const page = outDoc.getPage(placement.pageNum);
            const { width: pageWidthPt, height: pageHeightPt } = page.getSize();
            const image = embeddedSignatures[placement.signatureId];
            if (!image) continue;
            const scaleX = pageWidthPt / renderedPageWidth;
            const scaleY = pageHeightPt / renderedPageHeight;
            const sigWidthPt = placement.widthPx * scaleX;
            const sigHeightPt = placement.heightPx * scaleY;
            const pdfX = placement.x * scaleX;
            const pdfY = pageHeightPt - (placement.y * scaleY) - sigHeightPt;
            page.drawImage(image, { x: pdfX, y: pdfY, width: sigWidthPt, height: sigHeightPt });
        }

        const modifiedPdfBytes = await outDoc.save();
        const blob = new Blob([modifiedPdfBytes], { type: 'application/pdf' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.style.display = 'none'; a.href = url;
        a.download = `${pdfFile.name.replace(/\.pdf$/i, '')}_signed_clientside.pdf`;
        document.body.appendChild(a); a.click();
        window.URL.revokeObjectURL(url); document.body.removeChild(a);

        setStatus('Signed PDF generated successfully!', 'success');

    } catch (error) {
        console.error('Client-side PDF generation error:', error);
        setStatus(`PDF Generation Error: ${error.message || error}`, 'error');
    } finally {
        // Re-enable button after processing completes or fails
        generateButton.disabled = false;
        updateButtonStates();
    }
}

// Helper for rasterization path
function dataURLtoUint8Array(dataURL) {
    const base64 = dataURL.split(',')[1];
    const binaryString = atob(base64);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) bytes[i] = binaryString.charCodeAt(i);
    return bytes;
}


// ==========================================================
// ========= INITIALIZATION & EVENT LISTENERS ===============
// ==========================================================

document.addEventListener('DOMContentLoaded', () => {
    console.log("DOM Loaded. Initializing Client-Side PDF Gen script...");

    // --- Assign global element variables ---
    try {
        // Get all elements needed for both tabs and modal
        tabButtons = document.querySelectorAll('.tab-button'); tabContents = document.querySelectorAll('.tab-content');
        pdfFileInput = document.getElementById('pdf-upload'); sigUploadArea = document.getElementById('signature-upload-area'); sigDrawArea = document.getElementById('signature-draw-area');
        showUploadBtn = document.getElementById('show-upload-btn'); showDrawBtn = document.getElementById('show-draw-btn'); openDrawModalBtn = document.getElementById('open-draw-modal-btn');
        sigFileInput = document.getElementById('signature-upload'); signatureGallery = document.getElementById('signature-gallery'); viewerContainer = document.getElementById('viewer');
        signatureBox = document.getElementById('signatureBox'); signatureImage = document.getElementById('signatureImage'); prevPageButton = document.getElementById('prev-page'); nextPageButton = document.getElementById('next-page');
        pageNumSpan = document.getElementById('page-num'); pageCountSpan = document.getElementById('page-count'); addSigButton = document.getElementById('add-signature-btn');
        generateButton = document.getElementById('generate-button'); statusDiv = document.getElementById('status'); placedSignaturesList = document.getElementById('placed-signatures-list');
        // Convert Tab elements
        convertSigFileInput = document.getElementById('convert-sig-upload'); convertButton = document.getElementById('convert-button'); convertStatusDiv = document.getElementById('convert-status');
        convertResultArea = document.getElementById('convert-result-area'); convertedSigPreview = document.getElementById('converted-sig-preview'); downloadConvertedLink = document.getElementById('download-converted-link');
        // Signature Modal elements
        signatureModal = document.getElementById('signature-modal'); signaturePadCanvas = document.getElementById('signature-pad-canvas');
        clearSignatureBtn = document.getElementById('clear-signature-btn'); saveSignatureBtn = document.getElementById('save-signature-btn'); closeSignatureModalBtn = document.getElementById('close-signature-modal-btn');

        // Basic check for essential elements
        if (!pdfFileInput || !signatureGallery || !generateButton || !statusDiv || !convertButton || !convertStatusDiv || !signaturePadCanvas) {
             throw new Error("One or more critical UI elements are missing!");
        }
    } catch (error) {
        console.error("Error finding DOM elements:", error);
        alert("UI Initialization Error: " + error.message);
        return; // Stop execution if critical elements missing
    }

    // --- Verify essential libraries ---
    if (!checkLibraries()) {
        // Stop execution if critical libraries (pdf.js, pdf-lib.js) missing
        alert("Essential libraries failed to load. App cannot continue.");
        return;
    }

    // --- Initial Setup Calls ---
    // Disable buttons initially
    if(addSigButton) addSigButton.disabled = true;
    if(generateButton) generateButton.disabled = true;
    if(convertButton) convertButton.disabled = true;
    if(prevPageButton) prevPageButton.disabled = true;
    if(nextPageButton) nextPageButton.disabled = true;
    setupTabs(); // Set up tab switching
    setupSignatureInputToggle(); // Set up upload/draw toggle

    // --- Event Listeners ---
    // Sign PDF Tab related
    pdfFileInput?.addEventListener('change', handlePdfUpload);
    sigFileInput?.addEventListener('change', handleSignatureUpload);
    signatureGallery?.addEventListener('click', handleGalleryAction); // Use delegation handler
    prevPageButton?.addEventListener('click', goToPrevPage);
    nextPageButton?.addEventListener('click', goToNextPage);
    signatureBox?.addEventListener('mousedown', startDragOrResize);
    document.addEventListener('mousemove', handleMouseMove); // Attach to document for wider capture
    document.addEventListener('mouseup', handleMouseUp); // Attach to document
    signatureImage?.addEventListener('dragstart', (e) => e.preventDefault()); // Prevent ghost image drag
    addSigButton?.addEventListener('click', addPlacement);
    generateButton?.addEventListener('click', generateSignedPdfClientSide); // IMPORTANT: Call client-side function
    placedSignaturesList?.addEventListener('click', handleRemovePlacement);
    // Signature Input Toggle
    showUploadBtn?.addEventListener('click', showUploadMode);
    showDrawBtn?.addEventListener('click', showDrawMode);
    // Signature Pad Modal
    openDrawModalBtn?.addEventListener('click', openSignatureModal);
    closeSignatureModalBtn?.addEventListener('click', closeSignatureModal);
    clearSignatureBtn?.addEventListener('click', () => { if (signaturePad) signaturePad.clear(); });
    saveSignatureBtn?.addEventListener('click', saveDrawnSignature);
    // Convert Signature Tab
    convertSigFileInput?.addEventListener('change', handleConvertSigFileSelect);
    convertButton?.addEventListener('click', handleConvertSignature);
    // Global listener
    window.addEventListener('resize', resizeCanvas); // Resize sig pad if modal is open and window changes

    console.log("Client-Side PDF Generation script initialized successfully.");
}); // End DOMContentLoaded listener