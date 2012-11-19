function BMPImage(data) {
    (this.view = new jDataView(data)).readObject({
        // bitmap "magic" signature
        signature: function (view) {
            var magic = view.getString(2);
            if (magic != 'BM') throw new TypeError('Sorry, but only Windows BMP files are supported.');
            return magic;
        },
        // full file size
        fileSize: 'Uint32',
        reserved: 'Uint32',
        // offset of bitmap data
        dataOffset: 'Uint32',

        // size of DIB header
        dibHeaderSize: 'Uint32',
        // image dimensions
        size: {
            width: 'Uint32',
            height: 'Uint32'
        },
        // color planes count (equals 1)
        planesCount: 'Uint16',
        // color depth (bits per pixel)
        bpp: 'Uint16',
        // compression type
        compression: 'Uint32',
        // size of bitmap data
        dataSize: 'Uint32',
        // resolutions (pixels per meter)
        resolution: {
            horz: 'Uint32',
            vert: 'Uint32'
        },
        // total color count
        colorsCount: function (view) {
            return view.getUint32() || (this.bpp < 32 ? 1 << this.bpp : Math.pow(2, this.bpp))
        },
        // count of colors that are required for displaying image
        importantColorsCount: function (view) {
            return view.getUint32() || this.colorsCount
        },
        // color palette (mandatory for bpp <= 8)
        palette: function (view) {
            if (this.bpp > 8) return;

            var palette = [];
            // reading colors, alpha byte is not used so set to 255
            for (var i = 0; i < this.colorsCount; i++) {
                palette[i] = view.readObject({
                    b: 'Uint8',
                    g: 'Uint8',
                    r: 'Uint8',
                    a: function (view) {
                        view.skip(1);
                        return 255;
                    }
                });
            }
            return palette;
        },
        // color masks (needed for bpp = 16)
        mask: function (view) {
            if (this.bpp != 16) return;

            return view.readObject({
                r: 'Uint32',
                g: 'Uint32',
                b: 'Uint32'
            });
        }
    }, this);
}

BMPImage.prototype.drawToContext = function (context) {
    if (this.compression && this.compression != 3) throw new TypeError('Sorry, but RLE compressed images are not supported.');
    // seek to bitmap data start
    this.view.seek(this.dataOffset);

    // creating image data and initializing bitmask for extracting particular bit ranges
    var imgData = context.createImageData(this.size.width, this.size.height),
        colorIndex, bitNumber, bitMask = ~ (-1 << this.bpp);

    // timer start
    var drawStarted = Date.now();
    
    // iterating over resulting bitmap bottom-to-top, left-to-right
    for (var y = imgData.height - 1; y > 0; y--) {
        for (var x = 0; x < imgData.width; x++) {
            // calculating image data offset for point (x, y)
            var i = 4 * (y * this.size.width + x),
                color = {
                    a: 255
                };

            switch (this.bpp) {
            case 1:
            case 2:
            case 4:
                // extracting bit ranges from highest to lowest (and moving to next byte when finished inside current)
                if (!bitNumber) {
                    bitNumber = 8;
                    colorIndex = this.view.getUint8();
                }
                bitNumber -= this.bpp;
                color = this.palette[(colorIndex >> bitNumber) & bitMask];
                break;

            case 8:
                // simply taking color by it's index
                color = this.palette[this.view.getUint8()];
                break;

            case 16:
                // extracting RGB values using 5-6-5 encoding scheme and given masks
                colorIndex = this.view.getUint16();
                color.b = (colorIndex & this.mask.b) << 3;
                color.g = (colorIndex & this.mask.g) >> 3;
                color.r = (colorIndex & this.mask.r) >> 8;
                break;

            case 24:
                // reading RGB color
                this.view.readObject({
                    b: 'Uint8',
                    g: 'Uint8',
                    r: 'Uint8'
                }, color);
                break;

            case 32:
                // reading RGBA color
                this.view.readObject({
                    b: 'Uint8',
                    g: 'Uint8',
                    r: 'Uint8',
                    a: 'Uint8'
                }, color);
                break;

            default:
                throw new TypeError('Sorry, but ' + this.bpp + 'bpp images are not supported.');
            }

            // putting resulting RGBA values to image data
            imgData.data[i++] = color.r;
            imgData.data[i++] = color.g;
            imgData.data[i++] = color.b;
            imgData.data[i++] = color.a;
        }
        // padding new row's alignment to 4 bytes
        var offsetOverhead = (this.view.tell() - this.dataOffset) % 4;
        if (offsetOverhead) {
            this.view.skip(4 - offsetOverhead);
            bitNumber = 0;
        }
    }

    // timer stop
    this.drawTime = Date.now() - drawStarted;
    // calculating speed as pixels per millisecond
    this.drawSpeed = (this.size.width * this.size.height) / this.drawTime;

    // putting image data to given canvas context
    context.putImageData(imgData, 0, 0);
}

// reading image from File instance
BMPImage.readFromFile = function (file, callback) {
    if (!(file instanceof File)) return;

    function callbackImg(data) {
        callback.call(new BMPImage(data));
    }

    var reader = new FileReader;

    if ('readAsArrayBuffer' in reader) {
        // for browsers with ArrayBuffer reading support
        reader.onload = function () {
            callbackImg(this.result)
        };
        reader.readAsArrayBuffer(file);
    } else {
        // for browsers with only text and base64 reading support (text reading was not used because returns corrupted bytes after charset encoding)
        reader.onload = function () {
            callbackImg(atob(this.result.match(/base64,(.*)$/)[1]))
        };
        reader.readAsDataURL(file);
    }
}

// reading image from AJAX request
BMPImage.readFromUrl = function (url, callback) {
    var xhr = new XMLHttpRequest;
    xhr.open('GET', url, true);

    // good new browsers (XMLHttpRequest2-compliant)
    if ('responseType' in xhr) xhr.responseType = 'arraybuffer';
    // good old browsers (XMLHttpRequest-compliant)
    else if ('overrideMimeType' in xhr) xhr.overrideMimeType('text/plain; charset=x-user-defined');
    // IE (Microsoft.XMLHTTP-compliant)
    else xhr.setRequestHeader('Accept-Charset', 'x-user-defined');

    xhr.onload = function () {
        if (this.status != 200) throw new Error(this.statusText);
        // emulating response field for IE
        if (!('response' in this)) {
            this.response = this.responseText = (new VBArray(this.responseBody)).toArray().map(function (byte) {
                return String.fromCharCode(byte)
            }).join('');
        }
        callback.call(new BMPImage(this.response));
    }

    xhr.send();
}