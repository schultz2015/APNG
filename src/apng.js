/*
     * ==========================================
     * 修正 APNG 帧延迟
     *
     * UPNG 
     * delay_num = 毫秒
     * delay_den = 1000
     *
     * 兼容整数秒化成：
     * 6000ms  -> 6 / 1
     * 60000ms -> 60 / 1
     *
     * 重新计算 fcTL 的 CRC
     * ==========================================
     */

export function crc32(bytes) {
        let crc = 0xffffffff;

        for (let i = 0; i < bytes.length; i++) {
            crc ^= bytes[i];

            for (let bit = 0; bit < 8; bit++) {
                crc =
                    (crc & 1)
                        ? (crc >>> 1) ^ 0xedb88320
                        : (crc >>> 1);
            }
        }

        return (crc ^ 0xffffffff) >>> 0;
    }


export function writeU32BE(view, offset, value) {
        view.setUint32(offset, value >>> 0, false);
    }


export function writeU16BE(view, offset, value) {
        view.setUint16(offset, value & 0xffff, false);
    }


export function delayToFraction(milliseconds) {

        milliseconds = Math.max(
            0,
            Math.round(milliseconds)
        );

        if (milliseconds === 0) {
            return {
                num: 0,
                den: 1000
            };
        }

        // 6000 -> 6/1
        // 60000 -> 60/1
        // 3600000 -> 3600/1
        if (milliseconds % 1000 === 0) {
            const seconds = milliseconds / 1000;

            if (seconds <= 65535) {
                return {
                    num: seconds,
                    den: 1
                };
            }
        }

        // 对毫秒和 1000 求最大公约数
        let a = milliseconds;
        let b = 1000;

        while (b !== 0) {
            const t = a % b;
            a = b;
            b = t;
        }

        const num = milliseconds / a;
        const den = 1000 / a;

        if (num <= 65535 && den <= 65535) {
            return {
                num,
                den
            };
        }

        throw new Error(
            `延迟 ${milliseconds} ms 超出 APNG 时间字段范围`
        );
    }


export function patchAPNGDelays(pngBuffer, delays) {

        const data = new Uint8Array(pngBuffer);
        const view = new DataView(data.buffer);

        let offset = 8;
        let frameIndex = 0;

        while (offset + 12 <= data.length) {

            const length =
                view.getUint32(offset, false);

            const type =
                String.fromCharCode(
                    data[offset + 4],
                    data[offset + 5],
                    data[offset + 6],
                    data[offset + 7]
                );

            if (
                type === "fcTL" &&
                length === 26 &&
                frameIndex < delays.length
            ) {

                const fraction =
                    delayToFraction(delays[frameIndex]);

                // fcTL data:
                // 0  sequence number
                // 4  width
                // 8  height
                // 12 x offset
                // 16 y offset
                // 20 delay_num
                // 22 delay_den
                // 24 dispose
                // 25 blend

                const dataOffset =
                    offset + 8;

                writeU16BE(
                    view,
                    dataOffset + 20,
                    fraction.num
                );

                writeU16BE(
                    view,
                    dataOffset + 22,
                    fraction.den
                );

                // CRC = CRC(type + data)
                const crc =
                    crc32(
                        data.subarray(
                            offset + 4,
                            offset + 8 + length
                        )
                    );

                writeU32BE(
                    view,
                    offset + 8 + length,
                    crc
                );

                console.log(
                    `fcTL 第 ${frameIndex + 1} 帧：`,
                    `${fraction.num}/${fraction.den} 秒`,
                    `= ${delays[frameIndex]} ms`
                );

                frameIndex++;
            }

            offset += length + 12;

            if (type === "IEND") {
                break;
            }
        }

        return data.buffer;
    }


function readChunkType(data, offset) {
        return String.fromCharCode(
            data[offset + 4],
            data[offset + 5],
            data[offset + 6],
            data[offset + 7]
        );
    }


function createChunk(type, chunkData) {
        const typeBytes = new TextEncoder().encode(type);
        const data = new Uint8Array(chunkData);
        const chunk = new Uint8Array(data.length + 12);
        const view = new DataView(chunk.buffer);

        view.setUint32(0, data.length, false);
        chunk.set(typeBytes, 4);
        chunk.set(data, 8);
        writeU32BE(
            view,
            data.length + 8,
            crc32(chunk.subarray(4, data.length + 8))
        );

        return chunk;
    }


function getChunks(pngBuffer) {
        const data = new Uint8Array(pngBuffer);
        const chunks = [];
        let offset = 8;

        while (offset + 12 <= data.length) {
                const length = new DataView(
                    data.buffer,
                    data.byteOffset + offset,
                    4
                ).getUint32(0, false);

                if (offset + length + 12 > data.length) {
                        throw new Error("PNG chunk 数据不完整");
                }

                chunks.push({
                    type: readChunkType(data, offset),
                    data: data.slice(offset + 8, offset + 8 + length)
                });
                offset += length + 12;
        }

        if (offset !== data.length) {
                throw new Error("PNG 数据尾部不完整");
        }

        return chunks;
}


function setU32(data, offset, value) {
        new DataView(
            data.buffer,
            data.byteOffset,
            data.byteLength
        ).setUint32(offset, value >>> 0, false);
}

function buildPaletteTree(points, channel = 0) {
        if (!points.length) {
                return null;
        }

        const axis = channel % 4;
        points.sort(
                (first, second) =>
                        first.color[axis] - second.color[axis]
        );
        const middle = points.length >> 1;

        return {
                point: points[middle],
                axis,
                left: buildPaletteTree(points.slice(0, middle), axis + 1),
                right: buildPaletteTree(
                        points.slice(middle + 1),
                        axis + 1
                )
        };
}

function findNearestPaletteIndex(root, red, green, blue, alpha) {
        let nearestIndex = 0;
        let nearestDistance = Infinity;

        function search(node) {
                if (!node) {
                        return;
                }

                const color = node.point.color;
                const redDelta = red - color[0];
                const greenDelta = green - color[1];
                const blueDelta = blue - color[2];
                const alphaDelta = alpha - color[3];
                const distance =
                        redDelta * redDelta +
                        greenDelta * greenDelta +
                        blueDelta * blueDelta +
                        alphaDelta * alphaDelta;

                if (distance < nearestDistance) {
                        nearestDistance = distance;
                        nearestIndex = node.point.index;
                }

                const difference =
                        node.axis === 0
                                ? red - color[0]
                                : node.axis === 1
                                        ? green - color[1]
                                        : node.axis === 2
                                                ? blue - color[2]
                                                : alpha - color[3];
                const nearNode = difference < 0 ? node.left : node.right;
                const farNode = difference < 0 ? node.right : node.left;
                search(nearNode);
                if (difference * difference < nearestDistance) {
                        search(farNode);
                }
        }

        search(root);
        return nearestIndex;
}

export async function encodeDefaultImageWithPalette(
        rgbaBuffer,
        width,
        height,
        animationPNGBuffer
) {
        if (
                !(rgbaBuffer instanceof ArrayBuffer) ||
                !Number.isInteger(width) ||
                !Number.isInteger(height) ||
                width <= 0 ||
                height <= 0 ||
                rgbaBuffer.byteLength !== width * height * 4
        ) {
                throw new RangeError("默认预览图像素数据或尺寸无效");
        }

        const animationChunks = getChunks(animationPNGBuffer);
        const imageHeader = animationChunks.find(
                chunk => chunk.type === "IHDR"
        );
        const paletteChunk = animationChunks.find(
                chunk => chunk.type === "PLTE"
        );
        const transparencyChunk = animationChunks.find(
                chunk => chunk.type === "tRNS"
        );

        if (
                !imageHeader ||
                !paletteChunk ||
                paletteChunk.data.length === 0 ||
                paletteChunk.data.length % 3 !== 0 ||
                paletteChunk.data.length > 768 ||
                imageHeader.data[9] !== 3
        ) {
                throw new Error("动画帧没有可共享的索引色调色板");
        }
        const encodedWidth = new DataView(
                imageHeader.data.buffer,
                imageHeader.data.byteOffset,
                imageHeader.data.byteLength
        ).getUint32(0, false);
        const encodedHeight = new DataView(
                imageHeader.data.buffer,
                imageHeader.data.byteOffset,
                imageHeader.data.byteLength
        ).getUint32(4, false);
        if (encodedWidth !== width || encodedHeight !== height) {
                throw new RangeError("默认预览与动画帧尺寸不一致");
        }

        const paletteSize = paletteChunk.data.length / 3;
        const palette = Array.from(
                { length: paletteSize },
                (_, index) => [
                        paletteChunk.data[index * 3],
                        paletteChunk.data[index * 3 + 1],
                        paletteChunk.data[index * 3 + 2],
                        transparencyChunk?.data[index] ?? 255
                ].map(Number)
        );
        const paletteTree = buildPaletteTree(
                palette.map((color, index) => ({ color, index }))
        );
        const bitsPerPixel = imageHeader.data[8];
        if (![1, 2, 4, 8].includes(bitsPerPixel)) {
                throw new RangeError(
                        `不支持的索引色位深：${bitsPerPixel}`
                );
        }

        const rowBytes = Math.ceil(width * bitsPerPixel / 8);
        const scanlines = new Uint8Array(height * (rowBytes + 1));
        const pixels = new Uint8Array(rgbaBuffer);
        const colorIndices = new Map();

        palette.forEach((color, index) => {
                const key =
                        (((color[0] << 24) |
                                (color[1] << 16) |
                                (color[2] << 8) |
                                color[3]) >>> 0);
                if (!colorIndices.has(key)) {
                        colorIndices.set(key, index);
                }
        });

        for (let y = 0; y < height; y++) {
                const rowOffset = y * (rowBytes + 1);
                for (let x = 0; x < width; x++) {
                        const pixelOffset = (y * width + x) * 4;
                        const red = pixels[pixelOffset];
                        const green = pixels[pixelOffset + 1];
                        const blue = pixels[pixelOffset + 2];
                        const alpha = pixels[pixelOffset + 3];
                        const colorKey =
                                (((red << 24) |
                                        (green << 16) |
                                        (blue << 8) |
                                        alpha) >>> 0);
                        let paletteIndex = colorIndices.get(colorKey);

                        if (paletteIndex === undefined) {
                                paletteIndex = findNearestPaletteIndex(
                                        paletteTree,
                                        red,
                                        green,
                                        blue,
                                        alpha
                                );
                        }

                        if (bitsPerPixel === 8) {
                                scanlines[rowOffset + 1 + x] = paletteIndex;
                        } else {
                                const bitOffset = x * bitsPerPixel;
                                const byteOffset =
                                        rowOffset + 1 + (bitOffset >> 3);
                                const shift =
                                        8 - bitsPerPixel -
                                        (bitOffset & 7);
                                scanlines[byteOffset] |=
                                        paletteIndex << shift;
                        }
                }
        }

        if (typeof CompressionStream !== "function") {
                throw new Error(
                        "当前浏览器不支持无损压缩预览调色板数据"
                );
        }

        const compressedData = await new Response(
                new Blob([scanlines])
                        .stream()
                        .pipeThrough(new CompressionStream("deflate"))
        ).arrayBuffer();
        const header = new Uint8Array(13);
        const headerView = new DataView(header.buffer);
        headerView.setUint32(0, width, false);
        headerView.setUint32(4, height, false);
        header[8] = bitsPerPixel;
        header[9] = 3;
        const output = [
                new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
                createChunk("IHDR", header)
        ];

        for (const chunk of animationChunks) {
                if (chunk.type === "PLTE" || chunk.type === "tRNS") {
                        output.push(createChunk(chunk.type, chunk.data));
                } else if (
                        ["sRGB", "gAMA", "cHRM", "iCCP", "pHYs"].includes(
                                chunk.type
                        )
                ) {
                        output.push(createChunk(chunk.type, chunk.data));
                }
        }

        output.push(
                createChunk("IDAT", new Uint8Array(compressedData)),
                createChunk("IEND", new Uint8Array())
        );

        const resultLength = output.reduce(
                (length, chunk) => length + chunk.length,
                0
        );
        const result = new Uint8Array(resultLength);
        let resultOffset = 0;

        for (const chunk of output) {
                result.set(chunk, resultOffset);
                resultOffset += chunk.length;
        }

        return result.buffer;
}

export function combineDefaultImageWithAPNG(
        defaultPNGBuffer,
        animationPNGBuffer,
        singleFrameDelay = 1000
    ) {
        const defaultChunks = getChunks(defaultPNGBuffer);
        const animationChunks = getChunks(animationPNGBuffer);
        const animationControl = animationChunks.find(
            chunk => chunk.type === "acTL"
        );
        const animationFrames = animationChunks.filter(
            chunk => chunk.type === "fcTL"
        );
        const isStaticAnimation =
            !animationControl && animationFrames.length === 0;
        const animationImageHeader = animationChunks.find(
            chunk => chunk.type === "IHDR"
        );
        const animationImageData = animationChunks.filter(
            chunk => chunk.type === "IDAT"
        );

        if (
            (!animationControl && !isStaticAnimation) ||
            (animationControl && animationFrames.length === 0) ||
            (isStaticAnimation &&
                (!animationImageHeader || animationImageData.length === 0))
        ) {
            throw new Error("动画 PNG 缺少 APNG 控制信息");
        }

        const output = [
            new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])
        ];
        const controlData = animationControl
            ? animationControl.data.slice()
            : new Uint8Array(8);
        setU32(
            controlData,
            0,
            isStaticAnimation ? 1 : animationFrames.length
        );
        let frameIndex = -1;
        let sequenceNumber = 0;
        let controlInserted = false;

        for (const chunk of defaultChunks) {
            if (
                chunk.type === "IEND" ||
                chunk.type === "acTL" ||
                chunk.type === "fcTL" ||
                chunk.type === "fdAT"
            ) {
                continue;
            }

            if (chunk.type === "IDAT" && !controlInserted) {
                output.push(createChunk("acTL", controlData));
                controlInserted = true;
            }

            output.push(createChunk(chunk.type, chunk.data));
        }

        for (const chunk of animationChunks) {
            if (chunk.type === "fcTL") {
                frameIndex++;
                const frameControl = chunk.data.slice();
                setU32(frameControl, 0, sequenceNumber++);
                output.push(createChunk("fcTL", frameControl));
                continue;
            }

            if (chunk.type === "IDAT" && frameIndex === 0) {
                const frameData = new Uint8Array(chunk.data.length + 4);
                setU32(frameData, 0, sequenceNumber++);
                frameData.set(chunk.data, 4);
                output.push(createChunk("fdAT", frameData));
                continue;
            }

            if (chunk.type === "fdAT") {
                const frameData = new Uint8Array(chunk.data.length);
                setU32(frameData, 0, sequenceNumber++);
                frameData.set(chunk.data.slice(4), 4);
                output.push(createChunk("fdAT", frameData));
            }
        }

        if (!controlInserted) {
            throw new Error("PNG 缺少默认图像数据");
        }

        if (isStaticAnimation) {
            const frameControl = new Uint8Array(26);
            const frameView = new DataView(frameControl.buffer);
            const width = new DataView(
                animationImageHeader.data.buffer,
                animationImageHeader.data.byteOffset,
                animationImageHeader.data.byteLength
            ).getUint32(0, false);
            const height = new DataView(
                animationImageHeader.data.buffer,
                animationImageHeader.data.byteOffset,
                animationImageHeader.data.byteLength
            ).getUint32(4, false);
            const delay = delayToFraction(singleFrameDelay);
            writeU32BE(frameView, 0, sequenceNumber++);
            writeU32BE(frameView, 4, width);
            writeU32BE(frameView, 8, height);
            writeU32BE(frameView, 12, 0);
            writeU32BE(frameView, 16, 0);
            writeU16BE(frameView, 20, delay.num);
            writeU16BE(frameView, 22, delay.den);
            frameControl[24] = 0;
            frameControl[25] = 0;
            output.push(createChunk("fcTL", frameControl));

            for (const chunk of animationImageData) {
                const frameData = new Uint8Array(chunk.data.length + 4);
                setU32(frameData, 0, sequenceNumber++);
                frameData.set(chunk.data, 4);
                output.push(createChunk("fdAT", frameData));
            }
        }

        output.push(createChunk("IEND", new Uint8Array()));

        const resultLength = output.reduce(
            (length, chunk) => length + chunk.length,
            0
        );
        const result = new Uint8Array(resultLength);
        let resultOffset = 0;

        for (const chunk of output) {
            result.set(chunk, resultOffset);
            resultOffset += chunk.length;
        }

        return result.buffer;
}
