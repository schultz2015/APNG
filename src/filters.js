export function applyFrameFilter(
        ctx,
        width,
        height,
        filterType,
        filterAmount
    ) {

        if (
            filterType === "blur" ||
            !filterAmount
        ) {
            return;
        }

        const source = ctx.getImageData(0, 0, width, height);
        const output = ctx.createImageData(width, height);
        const sourceData = source.data;
        const outputData = output.data;

        if (filterType === "mosaic") {
            const cellSize = Math.max(4, Math.round(filterAmount));
            const radius = cellSize / 2;
            const sample = (x, y) =>
                (y * width + x) * 4;

            for (let y = 0; y < height; y += cellSize) {
                for (let x = 0; x < width; x += cellSize) {
                    const centerX = Math.min(
                        width - 1,
                        Math.floor(x + radius)
                    );
                    const centerY = Math.min(
                        height - 1,
                        Math.floor(y + radius)
                    );
                    const sourceIndex = sample(centerX, centerY);

                    for (
                        let pixelY = y;
                        pixelY < Math.min(y + cellSize, height);
                        pixelY++
                    ) {
                        for (
                            let pixelX = x;
                            pixelX < Math.min(x + cellSize, width);
                            pixelX++
                        ) {
                            const distanceX =
                                pixelX - (x + radius - .5);
                            const distanceY =
                                pixelY - (y + radius - .5);

                            if (
                                distanceX * distanceX +
                                distanceY * distanceY >
                                radius * radius
                            ) {
                                continue;
                            }

                            const outputIndex = sample(pixelX, pixelY);
                            outputData.set(
                                sourceData.slice(
                                    sourceIndex,
                                    sourceIndex + 4
                                ),
                                outputIndex
                            );
                        }
                    }
                }
            }

            ctx.putImageData(output, 0, 0);
            return;
        }

        const frostedSource =
            document.createElement("canvas");

        frostedSource.width = width;
        frostedSource.height = height;
        frostedSource
            .getContext("2d")
            .putImageData(source, 0, 0);

        ctx.clearRect(0, 0, width, height);
        ctx.save();
        ctx.filter =
            `blur(${Math.max(1, Math.round(filterAmount / 2))}px)`;
        ctx.drawImage(
            frostedSource,
            -filterAmount,
            -filterAmount,
            width + filterAmount * 2,
            height + filterAmount * 2
        );
        ctx.restore();

        ctx.fillStyle =
            `rgba(255, 255, 255, ${Math.min(
                .48,
                .12 + filterAmount / 120
            )})`;
        ctx.fillRect(0, 0, width, height);

        ctx.globalAlpha = .12;
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, width, height);
        ctx.globalAlpha = 1;
    }
