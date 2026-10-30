"use strict";
figma.showUI(__html__, {
    width: 440,
    height: 480,
    themeColors: true,
});
const exportableNodeTypes = new Set(['FRAME', 'COMPONENT', 'COMPONENT_SET', 'INSTANCE']);
function getExportableSelection() {
    return figma.currentPage.selection.filter((node) => exportableNodeTypes.has(node.type));
}
function postSelectionSummary() {
    const exportableNodes = getExportableSelection();
    figma.ui.postMessage({
        type: 'selection-summary',
        selectedCount: figma.currentPage.selection.length,
        exportableCount: exportableNodes.length,
        visibleExportableCount: exportableNodes.filter(isEffectivelyVisible).length,
    });
}
figma.on('selectionchange', postSelectionSummary);
figma.ui.onmessage = async (message) => {
    if (message.type === 'get-connection-mode') {
        try {
            const savedMode = await figma.clientStorage.getAsync('connection-mode');
            figma.ui.postMessage({
                type: 'connection-mode',
                connectionMode: savedMode === 'download' ? 'download' : 'local-server',
            });
        }
        catch {
            figma.ui.postMessage({ type: 'connection-mode', connectionMode: 'local-server' });
        }
        return;
    }
    if (message.type === 'set-connection-mode') {
        await figma.clientStorage.setAsync('connection-mode', message.connectionMode === 'download' ? 'download' : 'local-server');
        return;
    }
    if (message.type === 'selection-summary-request') {
        postSelectionSummary();
        return;
    }
    if (message.type === 'toggle-manual') {
        figma.ui.resize(440, message.open ? 620 : 480);
        return;
    }
    if (message.type === 'scan-bridges') {
        figma.notify('Scanning local Figma MCP folders…');
        const errors = [];
        const projects = (await Promise.all(Array.from({ length: 21 }, async (_, index) => {
            const port = 3847 + index;
            try {
                const response = await Promise.race([
                    fetch(`http://localhost:${port}/health`),
                    new Promise((_, reject) => setTimeout(() => reject(new Error('Timed out')), 800)),
                ]);
                return response.ok ? await response.json() : null;
            }
            catch (error) {
                if (port === 3847)
                    errors.push(errorMessage(error));
                return null;
            }
        }))).filter(Boolean);
        figma.notify(projects.length ? `Found ${projects.length} local folder connection${projects.length === 1 ? '' : 's'}.` : 'No local Figma MCP folder was reachable.');
        figma.ui.postMessage({ type: 'bridge-results', projects, errors });
        return;
    }
    if (message.type !== 'export-selection')
        return;
    const connectionMode = message.connectionMode === 'download' ? 'download' : 'local-server';
    if (connectionMode === 'local-server' && (!message.bridge || !message.token)) {
        figma.ui.postMessage({
            type: 'export-error',
            error: 'Select a local folder before exporting in Local server mode.',
            connectionMode,
        });
        return;
    }
    const exportMode = message.exportMode === 'no-filter' ? 'no-filter' : 'visible-only';
    const includeAssets = message.includeAssets === true;
    const selectedNodes = getExportableSelection();
    const nodes = exportMode === 'visible-only'
        ? selectedNodes.filter(isEffectivelyVisible)
        : selectedNodes;
    if (nodes.length === 0) {
        const error = exportMode === 'visible-only'
            ? 'Select one or more visible frames, components, component sets, or instances first, or choose No filter.'
            : 'Select one or more frames, components, component sets, or instances first.';
        figma.notify(error);
        figma.ui.postMessage({ type: 'export-error', error, connectionMode });
        return;
    }
    const savedFiles = [];
    const savedAssets = new Set();
    try {
        const exports = await Promise.all(nodes.map(async (node) => {
            const warnings = [];
            const skippedRenders = [];
            let exportedJson;
            try {
                exportedJson = await node.exportAsync({ format: 'JSON_REST_V1' });
            }
            catch (error) {
                throw new Error(`JSON export failed for "${node.name}" (${node.id}): ${errorMessage(error)}`);
            }
            const figmaJson = exportMode === 'visible-only'
                ? removeInvisibleNodes(exportedJson)
                : exportedJson;
            const includeHidden = exportMode === 'no-filter';
            const sourceIconClassification = classifyIconNode(node, false, includeHidden);
            const tokens = await resolveDesignTokens(node, figmaJson);
            const darkMode = await isDarkMode(node);
            const imageAssets = includeAssets
                ? await collectImageAssets(node, exportMode === 'no-filter', figmaJson)
                : [];
            const iconAssets = includeAssets
                ? await collectIconSvgAssets(node, includeHidden, warnings, figmaJson, skippedRenders)
                : [];
            const assets = [...imageAssets, ...iconAssets];
            const filename = `${slug(node.name)}-${exportMode}${darkMode ? '-dark' : ''}.json`;
            let preview;
            if (message.includePreview === true) {
                try {
                    preview = { base64: encodeBase64(await node.exportAsync({
                            format: 'PNG',
                            constraint: { type: 'SCALE', value: Math.min(1, 4096 / Math.max(node.width, node.height, 1)) },
                        })) };
                }
                catch (error) {
                    warnings.push({ format: 'PNG', nodeId: node.id, nodeName: node.name, message: errorMessage(error) });
                }
            }
            annotateExportedNodes(figmaJson, node, includeHidden, iconAssets, warnings, skippedRenders);
            return {
                filename,
                assets,
                preview,
                payload: {
                    schemaVersion: 1,
                    exportedAt: new Date().toISOString(),
                    source: {
                        pageName: figma.currentPage.name,
                        nodeId: node.id,
                        nodeName: node.name,
                        nodeType: node.type,
                        ...sourceIconClassification,
                    },
                    assets: assets.map(({ kind, imageHash, nodeId, nodeName, filename, mimeType }) => ({
                        kind,
                        ...(imageHash ? { imageHash } : {}),
                        ...(nodeId ? { nodeId, nodeName } : {}),
                        file: `../assets/${filename}`,
                        mimeType,
                    })),
                    ...tokens,
                    warnings,
                    skippedRenders,
                    ...(preview ? { preview: { file: `${filename.slice(0, -5)}.png`, mimeType: 'image/png' } } : {}),
                    figma: figmaJson,
                },
            };
        }));
        const warnings = exports.flatMap((entry) => entry.payload.warnings);
        const skippedRenders = exports.flatMap((entry) => entry.payload.skippedRenders);
        if (connectionMode === 'download') {
            const filenameCounts = new Map();
            const assets = new Map();
            for (const entry of exports) {
                const count = (filenameCounts.get(entry.filename) ?? 0) + 1;
                filenameCounts.set(entry.filename, count);
                const filename = count === 1
                    ? entry.filename
                    : `${entry.filename.slice(0, -'.json'.length)}-${count}.json`;
                if (entry.preview && entry.payload.preview) {
                    entry.payload.preview.file = `${filename.slice(0, -5)}.png`;
                    figma.ui.postMessage({
                        type: 'download-asset', filename: entry.payload.preview.file,
                        mimeType: 'image/png', base64: entry.preview.base64,
                    });
                }
                figma.ui.postMessage({
                    type: 'download-file',
                    filename,
                    content: JSON.stringify(entry.payload, null, 2),
                });
                entry.assets.forEach((asset) => assets.set(asset.filename, asset));
            }
            for (const asset of assets.values()) {
                figma.ui.postMessage({
                    type: 'download-asset',
                    filename: asset.filename,
                    mimeType: asset.mimeType,
                    base64: asset.base64,
                });
            }
            figma.ui.postMessage({ type: 'download-complete', count: exports.length, assetCount: assets.size, previewCount: exports.filter((entry) => entry.preview).length, warnings, skippedRenders, connectionMode });
            return;
        }
        const bridgeUrl = message.bridge;
        const bridgeToken = message.token;
        for (const entry of exports) {
            const result = await sendToBridge(bridgeUrl, bridgeToken, JSON.stringify({ filename: entry.filename, payload: entry.payload, assets: entry.assets, preview: entry.preview }));
            if (!isRecord(result) || typeof result.saved !== 'string') {
                throw new Error(`Server ${bridgeUrl} did not confirm a saved filename. Check the helper terminal and export folder before retrying.`);
            }
            savedFiles.push(result.saved);
            if (typeof result.preview === 'string')
                savedFiles.push(result.preview);
            if (Array.isArray(result.assets)) {
                result.assets.forEach((filename) => {
                    if (typeof filename === 'string')
                        savedAssets.add(filename);
                });
            }
        }
        figma.ui.postMessage({ type: 'export-complete', count: exports.length, files: savedFiles, assets: [...savedAssets], warnings, skippedRenders, includeAssets, connectionMode });
    }
    catch (error) {
        figma.ui.postMessage({ type: 'export-error', error: errorMessage(error), files: savedFiles, assets: [...savedAssets], includeAssets, connectionMode });
    }
};
function errorMessage(error) {
    if (typeof error === 'string' && error.trim())
        return error;
    if (isRecord(error)) {
        for (const key of ['message', 'error', 'reason', 'description']) {
            if (typeof error[key] === 'string' && error[key].trim())
                return error[key];
        }
        const details = ['name', 'code', 'status'].map((key) => error[key])
            .filter((value) => typeof value === 'string' || typeof value === 'number');
        if (details.length)
            return details.join(': ');
    }
    return 'No error details were provided.';
}
async function sendToBridge(url, token, body) {
    let timer;
    try {
        return await Promise.race([
            (async () => {
                let response;
                try {
                    response = await fetch(`${url}/export`, {
                        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Figma-Mcp-Token': token }, body,
                    });
                }
                catch (error) {
                    throw new Error(`Cannot reach the local server at ${url}. It may have stopped or the connection may be blocked. Start the helper in your target folder, click Refresh, and select the server again. Details: ${errorMessage(error)}`);
                }
                if (!response.ok) {
                    if (response.status === 403)
                        throw new Error(`Server ${url} rejected the connection token (HTTP 403). If the helper was restarted, click Refresh and select the server again, or update the manual token.`);
                    const text = await response.text();
                    let detail = text;
                    try {
                        detail = errorMessage(JSON.parse(text));
                    }
                    catch { }
                    throw new Error(`Server ${url} could not save the export (HTTP ${response.status}). ${detail || 'Check the helper terminal for details.'}`);
                }
                try {
                    return await response.json();
                }
                catch {
                    throw new Error(`Server ${url} returned an invalid response. Check the helper terminal and export folder before retrying.`);
                }
            })(),
            new Promise((_, reject) => {
                timer = setTimeout(() => reject(new Error(`Server ${url} did not respond within 15 seconds. Check the helper terminal. Files may already have been saved; check the export folder before retrying.`)), 15000);
            }),
        ]);
    }
    finally {
        if (timer !== undefined)
            clearTimeout(timer);
    }
}
function removeInvisibleNodes(value) {
    if (Array.isArray(value)) {
        return value.flatMap((child) => isInvisible(child) ? [] : [removeInvisibleNodes(child)]);
    }
    if (!isRecord(value))
        return value;
    if (isInvisible(value))
        return null;
    return Object.fromEntries(Object.entries(value).flatMap(([key, child]) => isInvisible(child) ? [] : [[key, removeInvisibleNodes(child)]]));
}
function isInvisible(value) {
    return isRecord(value) && value.visible === false;
}
function isEffectivelyVisible(node) {
    let current = node;
    while (current) {
        if ('visible' in current && current.visible === false)
            return false;
        current = current.parent;
    }
    return true;
}
async function isDarkMode(node) {
    if (hasDarkLabel(node.name) || hasDarkVariant(node))
        return true;
    const activeModeNames = await Promise.all(Object.entries(node.resolvedVariableModes).map(async ([collectionId, modeId]) => {
        try {
            const collection = await figma.variables.getVariableCollectionByIdAsync(collectionId);
            return collection?.modes.find((mode) => mode.modeId === modeId)?.name ?? '';
        }
        catch {
            return '';
        }
    }));
    return activeModeNames.some(hasDarkLabel);
}
function hasDarkVariant(node) {
    if (node.type === 'INSTANCE') {
        return Object.entries(node.componentProperties).some(([name, property]) => (property.type === 'VARIANT' && hasDarkLabel(String(property.value))) ||
            (hasDarkLabel(name) && property.value === true));
    }
    if (node.type === 'COMPONENT') {
        return Object.values(node.variantProperties ?? {}).some(hasDarkLabel);
    }
    return false;
}
function hasDarkLabel(value) {
    return /\bdark\b/i.test(value);
}
function slug(name) {
    return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'figma-node';
}
function classifyIconNode(node, insideKeyboard = false, includeHidden = false) {
    if (insideKeyboard || isInsideKeyboard(node)) {
        return { isIcon: false, iconClassification: 'excluded-keyboard' };
    }
    if ('exportSettings' in node && node.exportSettings.some((setting) => setting.format === 'SVG')) {
        // Explicit asset settings override inferred size/name rules, but never keyboard exclusion.
        if (!containsKeyboard(node))
            return { isIcon: true, iconClassification: 'svg-export-setting' };
    }
    const normalizedName = node.name.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase();
    const named = /(^|[\s/_.:-])(?:icon|icons|glyph|symbol|icn|ic)(?=$|[\s/_.:-])/.test(normalizedName);
    const isControl = /(^|[\s/_.:-])(?:button|btn|control|input|toolbar|screen|card)(?=$|[\s/_.:-])/.test(normalizedName);
    const maxSize = named ? 128 : 64;
    if (!isControl && Number.isFinite(node.width) && Number.isFinite(node.height)
        && Math.max(node.width, node.height) > 0 && Math.max(node.width, node.height) <= maxSize) {
        const geometry = inspectIconGeometry(node, includeHidden);
        // An unnamed filled frame is often a button or badge; descend to its glyph instead.
        const paintedContainer = 'children' in node && 'fills' in node && Array.isArray(node.fills) && node.fills.some((paint) => paint.visible !== false);
        if (geometry.valid && (geometry.vectors > 0 || geometry.primitives > 1 || (named && geometry.primitives > 0))) {
            if (named)
                return { isIcon: true, iconClassification: 'name-match' };
            if (!paintedContainer && Math.min(node.width, node.height) >= 8 && Math.max(node.width, node.height) / Math.min(node.width, node.height) <= 4) {
                return { isIcon: true, iconClassification: 'vector-shape' };
            }
        }
    }
    return { isIcon: false, iconClassification: 'not-detected' };
}
function isInsideKeyboard(node) {
    let current = node;
    while (current) {
        if (isKeyboardNodeName(current.name))
            return true;
        current = current.parent;
    }
    return false;
}
function containsKeyboard(node) {
    return isKeyboardNodeName(node.name) || ('children' in node && node.children.some(containsKeyboard));
}
function inspectIconGeometry(root, includeHidden) {
    const result = { valid: true, vectors: 0, primitives: 0 };
    const visit = (node) => {
        if (!result.valid || (!includeHidden && node !== root && !node.visible))
            return;
        if (isKeyboardNodeName(node.name) || node.type === 'TEXT') {
            result.valid = false;
            return;
        }
        for (const key of ['fills', 'strokes']) {
            const paints = key in node ? node[key] : undefined;
            if (Array.isArray(paints) && paints.some((paint) => paint.visible !== false && (paint.type === 'IMAGE' || paint.type === 'VIDEO'))) {
                result.valid = false;
                return;
            }
        }
        if (node.type === 'VECTOR' || node.type === 'BOOLEAN_OPERATION') {
            result.vectors++;
            if (node.type === 'BOOLEAN_OPERATION')
                return;
        }
        else if (['RECTANGLE', 'ELLIPSE', 'LINE', 'POLYGON', 'STAR'].includes(node.type))
            result.primitives++;
        else if (!['FRAME', 'GROUP', 'COMPONENT', 'INSTANCE'].includes(node.type)) {
            result.valid = false;
            return;
        }
        if ('children' in node)
            node.children.forEach(visit);
    };
    visit(root);
    return result;
}
function isKeyboardNodeName(name) {
    const normalizedName = name.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase();
    return /(^|[\s/_-])keyboard(?=$|[\s/_-])/.test(normalizedName);
}
function annotateExportedNodes(figmaJson, root, includeHidden, iconAssets = [], warnings = [], skippedRenders = []) {
    const svgFiles = new Map(iconAssets.map((asset) => [asset.nodeId, `../assets/${asset.filename}`]));
    const svgErrors = new Map(warnings.filter((warning) => warning.format === 'SVG').map((warning) => [warning.nodeId, warning.message]));
    const svgSkips = new Map(skippedRenders.map((skip) => [skip.nodeId, skip.reason]));
    const classifications = new Map();
    const collect = (node, ancestorsVisible, insideKeyboard) => {
        const visible = ancestorsVisible && node.visible;
        if (!includeHidden && !visible)
            return;
        const keyboardSubtree = insideKeyboard || isKeyboardNodeName(node.name);
        classifications.set(node.id, classifyIconNode(node, keyboardSubtree, includeHidden));
        if ('children' in node)
            node.children.forEach((child) => collect(child, visible, keyboardSubtree));
    };
    collect(root, true, false);
    const annotate = (value) => {
        if (Array.isArray(value)) {
            value.forEach(annotate);
            return;
        }
        if (!isRecord(value))
            return;
        if (typeof value.id === 'string') {
            const classification = classifications.get(value.id);
            if (classification)
                Object.assign(value, classification);
            const svgFile = svgFiles.get(value.id);
            if (svgFile)
                value.svgAsset = svgFile;
            const svgError = svgErrors.get(value.id);
            if (svgError)
                value.svgExportError = svgError;
            const svgSkip = svgSkips.get(value.id);
            if (svgSkip)
                value.svgExportSkipped = svgSkip;
        }
        Object.values(value).forEach(annotate);
    };
    annotate(figmaJson);
}
async function collectImageAssets(root, includeHidden, figmaJson) {
    const hashes = new Set();
    const visit = (node, ancestorsVisible) => {
        const visible = ancestorsVisible && node.visible;
        if (!includeHidden && !visible)
            return;
        const inspectPaints = (paints) => {
            if (!Array.isArray(paints))
                return;
            for (const paint of paints) {
                if (isRecord(paint) && paint.type === 'IMAGE' && typeof paint.imageHash === 'string') {
                    hashes.add(paint.imageHash);
                }
            }
        };
        if ('fills' in node)
            inspectPaints(node.fills);
        if ('strokes' in node)
            inspectPaints(node.strokes);
        if ('children' in node)
            node.children.forEach((child) => visit(child, visible));
    };
    visit(root, true);
    const visitJson = (value) => {
        if (Array.isArray(value)) {
            value.forEach(visitJson);
            return;
        }
        if (!isRecord(value))
            return;
        if (typeof value.imageRef === 'string')
            hashes.add(value.imageRef);
        if (value.type === 'IMAGE' && typeof value.imageHash === 'string')
            hashes.add(value.imageHash);
        Object.values(value).forEach(visitJson);
    };
    visitJson(figmaJson);
    return Promise.all([...hashes].map(async (imageHash) => {
        const image = figma.getImageByHash(imageHash);
        if (!image)
            throw new Error(`Could not load image asset ${imageHash}.`);
        const bytes = await image.getBytesAsync();
        const format = detectImageFormat(bytes);
        const hash = image.hash.replace(/[^a-z0-9_-]/gi, '') || imageHash.replace(/[^a-z0-9_-]/gi, '');
        if (!hash)
            throw new Error(`Could not name image asset ${imageHash}.`);
        return {
            kind: 'image',
            imageHash,
            filename: `image-${hash}.${format.extension}`,
            mimeType: format.mimeType,
            base64: encodeBase64(bytes),
        };
    }));
}
async function collectIconSvgAssets(root, includeHidden, warnings, figmaJson, skippedRenders) {
    const notRendered = new Set();
    const inspectRenderBounds = (value) => {
        if (Array.isArray(value)) {
            value.forEach(inspectRenderBounds);
            return;
        }
        if (!isRecord(value))
            return;
        if (typeof value.id === 'string' && value.absoluteRenderBounds === null)
            notRendered.add(value.id);
        Object.values(value).forEach(inspectRenderBounds);
    };
    if (!includeHidden)
        inspectRenderBounds(figmaJson);
    const iconNodes = [];
    const visit = (node, ancestorsVisible, insideKeyboard) => {
        const visible = ancestorsVisible && node.visible;
        if (!includeHidden && !visible)
            return;
        const keyboardSubtree = insideKeyboard || isInsideKeyboard(node);
        if (keyboardSubtree)
            return;
        if (classifyIconNode(node, keyboardSubtree, includeHidden).isIcon) {
            // A layer can be visible=true yet fully clipped by an ancestor frame.
            if (!includeHidden && (notRendered.has(node.id) || ('absoluteRenderBounds' in node && node.absoluteRenderBounds === null))) {
                skippedRenders.push({ format: 'SVG', nodeId: node.id, nodeName: node.name, reason: 'not-rendered' });
                return;
            }
            iconNodes.push(node);
            return;
        }
        if ('children' in node)
            node.children.forEach((child) => visit(child, visible, keyboardSubtree));
    };
    visit(root, true, false);
    const results = await Promise.all(iconNodes.map(async (node) => {
        try {
            const svg = await node.exportAsync({ format: 'SVG_STRING' });
            const base64 = encodeUtf8Base64(svg);
            const filename = `icon-${slug(node.name).replace(/^icons?(?:-|$)/, '') || 'asset'}.svg`;
            return {
                kind: 'icon',
                nodeId: node.id,
                nodeName: node.name,
                filename,
                mimeType: 'image/svg+xml',
                base64,
            };
        }
        catch (error) {
            warnings.push({ format: 'SVG', nodeId: node.id, nodeName: node.name, message: errorMessage(error) });
            return null;
        }
    }));
    return results.filter((asset) => asset !== null);
}
function encodeUtf8Base64(value) {
    const encoded = encodeURIComponent(value);
    const bytes = new Uint8Array(encoded.length);
    let length = 0;
    for (let index = 0; index < encoded.length; index += 1) {
        if (encoded[index] === '%') {
            bytes[length] = Number.parseInt(encoded.slice(index + 1, index + 3), 16);
            length += 1;
            index += 2;
        }
        else {
            bytes[length] = encoded.charCodeAt(index);
            length += 1;
        }
    }
    return encodeBase64(bytes.subarray(0, length));
}
function detectImageFormat(bytes) {
    if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
        return { extension: 'png', mimeType: 'image/png' };
    }
    if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
        return { extension: 'jpg', mimeType: 'image/jpeg' };
    }
    if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) {
        return { extension: 'gif', mimeType: 'image/gif' };
    }
    if (String.fromCharCode(...bytes.subarray(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.subarray(8, 12)) === 'WEBP') {
        return { extension: 'webp', mimeType: 'image/webp' };
    }
    if (String.fromCharCode(...bytes.subarray(4, 12)).includes('ftypavif')) {
        return { extension: 'avif', mimeType: 'image/avif' };
    }
    const prefix = String.fromCharCode(...bytes.subarray(0, 512)).trimStart().toLowerCase();
    if (prefix.startsWith('<svg') || (prefix.startsWith('<?xml') && prefix.includes('<svg'))) {
        return { extension: 'svg', mimeType: 'image/svg+xml' };
    }
    return { extension: 'bin', mimeType: 'application/octet-stream' };
}
function encodeBase64(bytes) {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    const chunks = [];
    const chunkSize = 0x3000;
    for (let start = 0; start < bytes.length; start += chunkSize) {
        const end = Math.min(start + chunkSize, bytes.length);
        let encoded = '';
        for (let index = start; index < end; index += 3) {
            const first = bytes[index];
            const hasSecond = index + 1 < end;
            const hasThird = index + 2 < end;
            const second = hasSecond ? bytes[index + 1] : 0;
            const third = hasThird ? bytes[index + 2] : 0;
            encoded += alphabet[first >> 2];
            encoded += alphabet[((first & 3) << 4) | (second >> 4)];
            encoded += hasSecond ? alphabet[((second & 15) << 2) | (third >> 6)] : '=';
            encoded += hasThird ? alphabet[third & 63] : '=';
        }
        chunks.push(encoded);
    }
    return chunks.join('');
}
async function resolveDesignTokens(root, figmaJson) {
    const sceneNodes = new Map();
    const visitSceneNode = (node) => {
        sceneNodes.set(node.id, node);
        if ('children' in node)
            node.children.forEach(visitSceneNode);
    };
    visitSceneNode(root);
    const bindings = [];
    const includedNodes = new Map();
    const visitExportNode = (value) => {
        if (!isRecord(value))
            return;
        const consumer = typeof value.id === 'string' ? sceneNodes.get(value.id) : undefined;
        if (consumer) {
            includedNodes.set(consumer.id, consumer);
            collectBindings(value, '$', consumer, bindings);
            if (Array.isArray(value.children))
                value.children.forEach(visitExportNode);
            return;
        }
        Object.values(value).forEach((child) => {
            if (Array.isArray(child))
                child.forEach(visitExportNode);
            else
                visitExportNode(child);
        });
    };
    visitExportNode(figmaJson);
    const styleConsumers = new Map();
    const addStyle = (id, consumer) => {
        if (typeof id !== 'string' || !id)
            return;
        if (!styleConsumers.has(id))
            styleConsumers.set(id, new Set());
        styleConsumers.get(id).add(consumer);
    };
    for (const consumer of includedNodes.values()) {
        const properties = { boundVariables: consumer.boundVariables };
        for (const key of ['fills', 'strokes', 'effects', 'layoutGrids']) {
            if (key in consumer)
                properties[key] = consumer[key];
        }
        collectBindings(properties, '$', consumer, bindings);
        for (const key of ['fillStyleId', 'strokeStyleId', 'textStyleId', 'effectStyleId', 'gridStyleId']) {
            if (key in consumer)
                addStyle(consumer[key], consumer);
        }
        if (consumer.type === 'TEXT') {
            const segments = consumer.getStyledTextSegments(['boundVariables', 'fills', 'textStyleId', 'fillStyleId']);
            for (const segment of segments) {
                collectBindings(segment, `$.text[${segment.start}:${segment.end}]`, consumer, bindings);
                addStyle(segment.textStyleId, consumer);
                addStyle(segment.fillStyleId, consumer);
            }
        }
    }
    const styles = await Promise.all([...styleConsumers].map(async ([id, consumers]) => {
        const entry = { id, consumerNodeIds: [...consumers].map((node) => node.id) };
        try {
            const style = await figma.getStyleByIdAsync(id);
            if (!style)
                throw new Error('Style could not be resolved in this file.');
            // Read explicit properties: spreading a Figma host object can omit its getters.
            for (const key of ['name', 'key', 'type', 'description', 'remote', 'paints', 'effects', 'layoutGrids',
                'fontName', 'fontSize', 'lineHeight', 'letterSpacing', 'paragraphIndent', 'paragraphSpacing',
                'textCase', 'textDecoration', 'listSpacing', 'leadingTrim', 'textWrapStyle',
                'hangingPunctuation', 'hangingList', 'boundVariables']) {
                if (key in style)
                    entry[key] = style[key];
            }
            for (const consumer of consumers)
                collectBindings(entry, `$.styles[${id}]`, consumer, bindings);
        }
        catch (error) {
            entry.error = errorMessage(error);
        }
        return entry;
    }));
    const variableCache = new Map();
    const getVariable = (id) => {
        let variable = variableCache.get(id);
        if (!variable) {
            variable = figma.variables.getVariableByIdAsync(id);
            variableCache.set(id, variable);
        }
        return variable;
    };
    const collectionCache = new Map();
    const getCollection = (id) => {
        let collection = collectionCache.get(id);
        if (!collection) {
            collection = figma.variables.getVariableCollectionByIdAsync(id);
            collectionCache.set(id, collection);
        }
        return collection;
    };
    const uniqueBindings = [...new Map(bindings.map((binding) => [`${binding.consumer.id}:${binding.id}:${binding.bindingPath}`, binding])).values()];
    const variables = await Promise.all(uniqueBindings.map(async ({ id, bindingPath, consumer }) => {
        const entry = {
            id,
            name: null,
            type: null,
            collection: null,
            mode: null,
            consumerNodeId: consumer.id,
            consumerNodeName: consumer.name,
            bindingPath,
            value: null,
        };
        try {
            const variable = await getVariable(id);
            if (!variable) {
                entry.error = 'Variable could not be resolved in this file.';
                return entry;
            }
            entry.name = variable.name;
            entry.type = variable.resolvedType;
            const collection = await getCollection(variable.variableCollectionId);
            entry.collection = collection?.name ?? null;
            const modeId = consumer.resolvedVariableModes[variable.variableCollectionId] ?? collection?.defaultModeId;
            entry.mode = collection?.modes.find((mode) => mode.modeId === modeId)?.name ?? null;
            const resolved = variable.resolveForConsumer(consumer);
            entry.value = resolved.value;
            if (resolved.resolvedType === 'COLOR')
                entry.hex = colorToHex(resolved.value);
        }
        catch (error) {
            entry.error = errorMessage(error);
        }
        return entry;
    }));
    const variableDefinitions = [];
    const pending = [...new Set(uniqueBindings.map((binding) => binding.id))];
    const visited = new Set();
    while (pending.length) {
        const id = pending.shift();
        if (visited.has(id))
            continue;
        visited.add(id);
        const entry = { id };
        try {
            const variable = await getVariable(id);
            if (!variable)
                throw new Error('Variable definition could not be resolved in this file.');
            const collection = await getCollection(variable.variableCollectionId);
            Object.assign(entry, {
                name: variable.name, key: variable.key, type: variable.resolvedType,
                description: variable.description, remote: variable.remote, scopes: variable.scopes,
                codeSyntax: variable.codeSyntax, collectionId: variable.variableCollectionId,
                collection: collection ? { name: collection.name, modes: collection.modes, defaultModeId: collection.defaultModeId } : null,
                valuesByMode: variable.valuesByMode,
            });
            for (const value of Object.values(variable.valuesByMode)) {
                if (isRecord(value) && value.type === 'VARIABLE_ALIAS' && typeof value.id === 'string')
                    pending.push(value.id);
            }
        }
        catch (error) {
            entry.error = errorMessage(error);
        }
        variableDefinitions.push(entry);
    }
    return { variables, variableDefinitions, styles };
}
function collectBindings(value, path, consumer, bindings) {
    for (const [key, child] of Object.entries(value)) {
        if (key === 'children')
            continue;
        const childPath = `${path}.${key}`;
        if (key === 'boundVariables') {
            collectVariableIds(child, childPath, consumer, bindings);
        }
        else if (isRecord(child)) {
            collectBindings(child, childPath, consumer, bindings);
        }
        else if (Array.isArray(child)) {
            child.forEach((item, index) => {
                if (isRecord(item))
                    collectBindings(item, `${childPath}[${index}]`, consumer, bindings);
            });
        }
    }
}
function collectVariableIds(value, path, consumer, bindings) {
    if (Array.isArray(value)) {
        value.forEach((item, index) => collectVariableIds(item, `${path}[${index}]`, consumer, bindings));
    }
    else if (isRecord(value)) {
        if (typeof value.id === 'string') {
            bindings.push({ id: value.id, bindingPath: path, consumer });
            return;
        }
        for (const [key, child] of Object.entries(value)) {
            collectVariableIds(child, `${path}.${key}`, consumer, bindings);
        }
    }
}
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function colorToHex(value) {
    if (!isRecord(value) || !['r', 'g', 'b'].every((channel) => typeof value[channel] === 'number'))
        return undefined;
    const channels = ['r', 'g', 'b'].map((channel) => Math.round(Math.max(0, Math.min(1, value[channel])) * 255));
    if (typeof value.a === 'number' && value.a < 1) {
        channels.push(Math.round(Math.max(0, Math.min(1, value.a)) * 255));
    }
    return `#${channels.map((channel) => channel.toString(16).padStart(2, '0')).join('').toUpperCase()}`;
}
