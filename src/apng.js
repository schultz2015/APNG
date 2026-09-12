/*
     * ==========================================
     * 修正 APNG 帧延迟
     *
     * UPNG 会把毫秒直接写成：
     * delay_num = 毫秒
     * delay_den = 1000
     *
     * 这种写法在 APNG 标准上是合法的，但为了兼容
     * 某些 APNG 播放器，这里把整数秒化成：
     * 6000ms  -> 6 / 1
     * 60000ms -> 60 / 1
     *
     * 同时重新计算 fcTL 的 CRC。
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


export function combineDefaultImageWithAPNG(
        defaultPNGBuffer,
        animationPNGBuffer
    ) {
        const defaultChunks = getChunks(defaultPNGBuffer);
        const animationChunks = getChunks(animationPNGBuffer);
        const animationControl = animationChunks.find(
            chunk => chunk.type === "acTL"
        );
        const animationFrames = animationChunks.filter(
            chunk => chunk.type === "fcTL"
        );

        if (!animationControl || animationFrames.length === 0) {
                throw new Error("动画 PNG 缺少 APNG 控制信息");
        }

        const output = [
                new Uint8Array([
                    137, 80, 78, 71, 13, 10, 26, 10
                ])
        ];
        const controlData = animationControl.data.slice();
        setU32(controlData, 0, animationFrames.length);

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
