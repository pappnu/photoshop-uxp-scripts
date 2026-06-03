// Make sure not to accidentally import non-types from "photoshop/..."
import { app, constants, action, core } from "photoshop";
import { type Document } from "photoshop/dom/Document";
import { type Layer } from "photoshop/dom/Layer";

interface SizeState {
  _obj: string;
  width: number;
  height: number;
}

interface SmartObjectMore {
  size: SizeState;
  [key: string]: unknown;
}

try {
  function isSmartObjectMore(
    value: object
  ): value is { smartObjectMore: SmartObjectMore } {
    return "smartObjectMore" in value;
  }

  async function deleteGroupAndContents(layer: Layer) {
    app.activeDocument.activeLayers = [layer];
    await action.batchPlay(
      [{ _obj: "delete", _target: [{ _enum: "ordinal", _ref: "layer" }] }],
      {}
    );
  }

  async function unlockLayer(layer: Layer) {
    app.activeDocument.activeLayers = [layer];
    await action.batchPlay(
      [
        {
          _obj: "applyLocking",
          _target: [{ _enum: "ordinal", _ref: "layer" }],
          layerLocking: { _obj: "layerLocking", protectNone: true },
        },
      ],
      {}
    );
  }

  async function freeTransform(
    layer: Layer,
    { width = 0, height = 0, horizontal = 0, vertical = 0 }
  ) {
    app.activeDocument.activeLayers = [layer];
    const command = {
      _obj: "transform",
      freeTransformCenterState: {
        _enum: "quadCenterState",
        _value: "QCSAverage",
      },
      height: { _unit: "percentUnit", _value: height },
      offset: {
        _obj: "offset",
        horizontal: { _unit: "pixelsUnit", _value: horizontal },
        vertical: { _unit: "pixelsUnit", _value: vertical },
      },
      replaceLayer: {
        _obj: "transform",
        from: { _id: layer.id, _ref: "layer" },
        to: { _id: layer.id, _ref: "layer" },
      },
      width: { _unit: "percentUnit", _value: width },
    };
    await action.batchPlay([command], {});
  }

  async function getNativeSizeOfSmartObject(layer: Layer): Promise<SizeState> {
    app.activeDocument.activeLayers = [layer];
    const command = {
      _obj: "get",
      _target: {
        _ref: [
          { _property: "smartObjectMore" },
          { _ref: "layer", _id: layer.id },
        ],
      },
    };
    const result = (await action.batchPlay([command], {}))[0];

    if (!isSmartObjectMore(result))
      throw new Error(
        `Couldn't get 'smartObjectMore' block from layer '${layer.name}'`
      );

    return result.smartObjectMore.size;
  }

  async function autoAlignSmartObjects(doc: Document, layers: Layer[]) {
    const layersThatCanBeAlignedAsIs: Layer[] = [];
    const smartObjs: Layer[] = [];
    const lockedSmartObjs: Layer[] = [];

    const unsupportedLayers: Layer[] = [];

    for (const layer of layers) {
      if (layer.kind === constants.LayerKind.SMARTOBJECT) {
        if (layer.locked) lockedSmartObjs.push(layer);
        else smartObjs.push(layer);
      } else if (layer.kind === constants.LayerKind.NORMAL)
        layersThatCanBeAlignedAsIs.push(layer);
      else unsupportedLayers.push(layer);
    }

    if (unsupportedLayers.length > 0) {
      const layerList = unsupportedLayers
        .map((layer) => `${layer.id} - ${layer.name}`)
        .join("\n");
      app.showAlert(
        `The following layers aren't supported and will be ignored:\n${layerList}`
      );
    }

    const wGroup = await doc.createLayerGroup();
    if (!wGroup) throw new Error("Failed to create work group");
    const workGroup = wGroup;

    const rasterizedSmartObjs: Layer[] = [];
    const lockedRasterizedSmartObjs: Layer[] = [];

    try {
      async function copyToWorkGroup(layer: Layer): Promise<Layer> {
        const lyr = await layer.duplicate(
          workGroup,
          constants.ElementPlacement.PLACEINSIDE
        );
        if (!lyr) throw new Error(`Failed to copy layer '${layer.name}' to work group`);
        return lyr
      }

      async function rasterizeLayer(layer: Layer) {
        layer.allLocked = false;
        await layer.rasterize(constants.RasterizeType.ENTIRELAYER);
        layer.allLocked = true;
      }

      for (const smartObj of smartObjs) {
        const smartCopy = await copyToWorkGroup(smartObj);
        const nativeSize = await getNativeSizeOfSmartObject(smartCopy);
        await freeTransform(smartCopy, {
          width: (nativeSize.width / smartCopy.bounds.width) * 100,
          height: (nativeSize.height / smartCopy.bounds.height) * 100,
        });
        rasterizedSmartObjs.push(smartCopy);
      }
      for (const lockedLayer of lockedSmartObjs) {
        lockedRasterizedSmartObjs.push(await copyToWorkGroup(lockedLayer));
      }

      const toRasterize = rasterizedSmartObjs.map((layer) =>
        layer.rasterize(constants.RasterizeType.ENTIRELAYER)
      );
      for (const layer of lockedRasterizedSmartObjs) {
        toRasterize.push(rasterizeLayer(layer));
      }

      await Promise.all(toRasterize);

      doc.activeLayers = layersThatCanBeAlignedAsIs.concat(
        rasterizedSmartObjs,
        lockedRasterizedSmartObjs
      );

      await action.batchPlay(
        [
          {
            _obj: "align",
            _target: [{ _enum: "ordinal", _ref: "layer" }],
            alignToCanvas: false,
            apply: { _enum: "projection", _value: "auto" },
            radialDistort: false,
            using: { _enum: "alignDistributeSelector", _value: "ADSContent" },
            vignette: false,
          },
        ],
        {}
      );

      for (let i = 0; i < smartObjs.length; i++) {
        const smartObj = smartObjs[i];
        const alignedLayer = rasterizedSmartObjs[i];
        const smartBounds = smartObj.bounds;
        const alignedBounds = alignedLayer.bounds;
        await freeTransform(smartObj, {
          width: (alignedBounds.width / smartBounds.width) * 100,
          height: (alignedBounds.height / smartBounds.height) * 100,
          horizontal:
            alignedBounds.left +
            alignedBounds.width / 2 -
            (smartBounds.left + smartBounds.width / 2),
          vertical:
            alignedBounds.top +
            alignedBounds.height / 2 -
            (smartBounds.top + smartBounds.height / 2),
        });
      }
    } finally {
      const operations: Promise<void>[] = lockedRasterizedSmartObjs.map(
        (layer) => unlockLayer(layer)
      );
      await Promise.all(operations);
      await deleteGroupAndContents(workGroup);
    }
  }

  // await has to be added in the build phase as tsc doesn't support outputting
  // CommonJS with top level await
  core.executeAsModal(
    async () => {
      await autoAlignSmartObjects(
        app.activeDocument,
        app.activeDocument.activeLayers
      );
    },
    { commandName: "Auto Align Smart Objects" }
  );
} catch (error) {
  navigator.clipboard.writeText(`${error}\n${error && typeof error === "object" && "stack" in error ? error.stack : ""}`);
  app.showAlert(`${error}\nSee system clipboard for possibly more details.`);
}
