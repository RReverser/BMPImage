jDataView.prototype.skip = function (count) {
    this.seek(this.tell() + count);
}

jDataView.prototype.readObject = function (dataMap, dest) {
    if (dest == null) dest = {};

    for (var index in dataMap) {
        var value = dataMap[index];
        switch (typeof value) {
        case 'object':
            if (Object.getPrototypeOf(value) === Object.prototype) {
                value = this.readObject(value);
            }
            break;
        case 'function':
            value = value.call(dest, this);
            break;
        case 'string':
            var readFunc = this['get' + value];
            if (readFunc) value = readFunc.call(this);
            break;
        }
        if (value != null) dest[index] = value;
    }
    return dest;
}

jDataView.prototype.slice = function(byteOffset, byteLength) {
    byteStart = byteOffset || 0;
    byteEnd = byteOffset + (byteLength || this.byteLength);
    
    // .slice(-offset, ...) should return range [fullLength - offset...]
    if(byteStart < 0) byteStart += this.byteLength;
    // .slice(-tooBigOffset, ...) should return range [0...]
    if(byteStart < 0) byteStart = 0;
    // no length < 0 allowed
    if(byteEnd < byteStart) byteEnd = byteStart;
    // no length > fullLength - offset allowed
    if(byteEnd >= this.byteLength) byteEnd = this.byteLength;
    
    return new jDataView(this.buffer, byteStart, byteEnd - byteStart, this._littleEndian);
}

jDataView.prototype.toString = function () {
    var offset = this.tell();
    result = this.getString(this.byteLength, 0);
    this.seek(offset);
    return result;
}