/*
 * Shrinks a phone photo off the main thread so the page stays responsive.
 * In: { id, file, max, quality }   Out: { id, ok, blob, w, h } or { id, ok: false, error }
 * Re-encoding also drops the photo's hidden metadata (GPS location, camera details).
 */
self.onmessage = function (e) {
  var d = e.data;
  createImageBitmap(d.file, { imageOrientation: 'from-image' }).then(function (bmp) {
    var scale = Math.min(1, d.max / Math.max(bmp.width, bmp.height));
    var w = Math.max(1, Math.round(bmp.width * scale));
    var h = Math.max(1, Math.round(bmp.height * scale));
    var canvas = new OffscreenCanvas(w, h);
    var ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.fillStyle = '#ffffff'; // transparent PNGs become white, not black
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(bmp, 0, 0, w, h);
    if (bmp.close) bmp.close();
    return canvas.convertToBlob({ type: 'image/jpeg', quality: d.quality }).then(function (blob) {
      self.postMessage({ id: d.id, ok: true, blob: blob, w: w, h: h });
    });
  }).catch(function (err) {
    self.postMessage({ id: d.id, ok: false, error: String((err && err.message) || err) });
  });
};
