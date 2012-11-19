function BMPImage(data) {
    this.parser = new jParser(data, BMPImage.structure);
    this.meta = this.parser.parse('header');
}

BMPImage.structure = {
    bgr: {
        b: 'uint8',
        g: 'uint8',
        r: 'uint8'
    },
    bgra: {
        b: 'uint8',
        g: 'uint8',
        r: 'uint8',
        a: 'uint8'
    },
    size: {
        horz: 'uint32',
        vert: 'uint32'
    },
    header: {
        // bitmap "magic" signature
        signature: function() {
            var magic = this.parse(['string', 2]);
            if (magic != 'BM') {
                throw new TypeError('Sorry, but only Windows BMP files are supported.');
            }
            return magic;
        },
        // full file size
        fileSize: 'uint32',
        // reserved
        reserved: 'uint32',
        // offset of bitmap data
        dataOffset: 'uint32',
        // size of DIB header
        dibHeaderSize: 'uint32',
        // image dimensions
        size: 'size',
        // color planes count (equals 1)
        planesCount: 'uint16',
        // color depth (bits per pixel)
        bpp: 'uint16',
        // compression type
        compression: 'uint32',
        // size of bitmap data
        dataSize: 'uint32',
        // resolutions (pixels per meter)
        resolution: 'size',
        // total color count
        colorsCount: function() { return this.parse('uint32') || Math.pow(2, this.current.bpp) /* (1 << bpp) not applicable for 32bpp */ },
        // count of colors that are required for displaying image
        importantColorsCount: function() { return this.parse('uint32') || this.current.colorsCount },
        // color palette (mandatory for <=8bpp images)
        palette: [
            'array',
            function() {
                var color = this.parse('bgr');
                // align to 4 bytes
                this.skip(1);
                return color;
            },
            function() { return this.current.bpp <= 8 ? this.current.colorsCount : 0 }
        ],
        // color masks (needed for 16bpp images)
        mask: {
            r: 'uint32',
            g: 'uint32',
            b: 'uint32'
        }
    }
}

BMPImage.prototype.drawToCanvas = function(canvas) {
    canvas.width = this.meta.size.horz;
    canvas.height = this.meta.size.vert;
    this.drawToContext(canvas.getContext('2d'));
}

BMPImage.prototype.drawToContext = function(context) {
    if (this.meta.compression && this.meta.compression != 3) {
        throw new TypeError('Sorry, but RLE compressed images are not supported.');
    }

// seek to bitmap data start
this.parser.seek(this.meta.dataOffset);

    var
        // saving image sizes
        size = this.meta.size,
        // creating image data
        imgData = context.createImageData(size.horz, size.vert),
        // initializing bitmask for extracting particular bit ranges
        bitMask = ~ (-1 << this.meta.bpp),
        // color bit offset for <8bpp images
        bitNumber,
        // color index (should be stored between iterations for <8bpp images)
        colorIndex;

    // timer start
    var drawStartedTime = Date.now();

    // iterating over resulting bitmap bottom-to-top, left-to-right
    for (var y = size.vert - 1; y > 0; y--) {
        // calculating image data offset for row [y]
        var dataPos = 4 * y * size.horz;

        // iterating over row pixels
        for (var x = 0; x < size.horz; x++) {
            var color;

            switch (this.meta.bpp) {
                case 1:
                case 2:
                case 4:
                    // extracting bit ranges from highest to lowest (and moving to next byte when finished inside current)
                    if (!bitNumber) {
                        bitNumber = 8;
                        colorIndex = this.parser.view.getUint8();
                    }
                    bitNumber -= this.meta.bpp;
                    color = this.meta.palette[(colorIndex >> bitNumber) & bitMask];
                    break;

                case 8:
                    // simply taking color by it's index
                    color = this.meta.palette[this.parser.view.getUint8()];
                    break;

                case 16:
                    // extracting RGB values using 5-6-5 encoding scheme and given masks
                    colorIndex = this.parser.view.getUint16();
                    color = {
                        b: (colorIndex & this.meta.mask.b) << 3,
                        g: (colorIndex & this.meta.mask.g) >> 3,
                        r: (colorIndex & this.meta.mask.r) >> 8
                    };
                    break;

                case 24:
                    // reading RGB color
                    color = this.parser.parse('bgr');
                    break;

                case 32:
                    // reading RGBA color
                    color = this.parser.parse('bgra');
                    break;

                default:
                    throw new TypeError('Sorry, but ' + this.meta.bpp + 'bpp images are not supported.');
            }

            // putting resulting RGBA values to image data
            imgData.data[dataPos++] = color.r;
            imgData.data[dataPos++] = color.g;
            imgData.data[dataPos++] = color.b;
            imgData.data[dataPos++] = color.a || 255;
        }

        // padding new row's alignment to 4 bytes
        var offsetOverhead = (this.parser.tell() - this.meta.dataOffset) % 4;
        if (offsetOverhead) {
            this.parser.skip(4 - offsetOverhead);
            bitNumber = 0;
        }
    }

    var drawTime = Date.now() - drawStartedTime;

    this.meta.profiler = {
        // timer stop
        time: drawTime,
        // calculating speed as pixels per millisecond
        speed: (size.horz * size.vert) / drawTime
    }

    // putting image data to given canvas context
    context.putImageData(imgData, 0, 0);
}

BMPImage.readFrom = function(source, callback) {
    function callbackImg(data) { callback.call(new BMPImage(data)) }

    if (source instanceof File) {
        // reading image from File instance

        var reader = new FileReader;
        reader.onload = function() { callbackImg(this.result) }
        reader.readAsArrayBuffer(source);
    } else {
        // reading image with AJAX request

        var xhr = new XMLHttpRequest;
        xhr.open('GET', source, true);

        // new browsers (XMLHttpRequest2-compliant)
        if ('responseType' in xhr) {
            xhr.responseType = 'arraybuffer';
        }
        // old browsers (XMLHttpRequest-compliant)
        else if ('overrideMimeType' in xhr) {
            xhr.overrideMimeType('text/plain; charset=x-user-defined');
        }
        // IE9 (Microsoft.XMLHTTP-compliant)
        else {
            xhr.setRequestHeader('Accept-Charset', 'x-user-defined');
        }

        xhr.onload = function() {
            if (this.status != 200) {
                throw new Error(this.statusText);
            }
            // emulating response field for IE9
            if (!('response' in this)) {
                this.response = new VBArray(this.responseBody).toArray().map(String.fromCharCode).join('');
            }
            callbackImg(this.response);
        }

        xhr.send();
    }
}