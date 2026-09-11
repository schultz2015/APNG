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
