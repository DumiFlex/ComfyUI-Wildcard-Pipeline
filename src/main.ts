import { app } from "#comfyui/app";
import type {
  ComfyNode,
  ComfyWidget,
  ComfyNodeType,
  ComfyNodeData,
  ComfyApp,
} from "#comfyui/app";
import { pipelineConfigWidgetFactory, injectConfigWidgetFactory, mountAssemblerPreview } from "./extension/widgets";
import { findDownstreamAssemblers } from "./extension/graph";

const ASSEMBLER_NODE_CLASS = "WP_PromptAssembler";

app.registerExtension({
  name: "Wildcard Pipeline",

  getCustomWidgets(/* _app: ComfyApp */) {
    return {
      WP_PIPELINE_CONFIG(node: ComfyNode, inputName: string, _inputData: unknown, _app: ComfyApp) {
        return pipelineConfigWidgetFactory(node, inputName);
      },
      WP_INJECT_CONFIG(node: ComfyNode, inputName: string, _inputData: unknown, _app: ComfyApp) {
        return injectConfigWidgetFactory(node, inputName);
      },
    };
  },

  async beforeRegisterNodeDef(nodeType: ComfyNodeType, nodeData: ComfyNodeData) {
    // Assembler preview is an additive display widget — still uses onNodeCreated
    if (nodeData.name === ASSEMBLER_NODE_CLASS) {
      const origOnCreated = nodeType.prototype.onNodeCreated;
      nodeType.prototype.onNodeCreated = function (this: ComfyNode, ...args: unknown[]) {
        origOnCreated?.apply(this, args);

        const templateWidget = this.widgets?.find((w) => w.name === "template");
        const refreshPreview = mountAssemblerPreview(this, templateWidget ?? null);

        const self = this as ComfyNode & { _wpRefreshPreview?: () => void };
        self._wpRefreshPreview = refreshPreview;

        if (templateWidget) {
          const origCallback = templateWidget.callback;
          templateWidget.callback = (...args: unknown[]) => {
            origCallback?.(...args);
            refreshPreview();
          };
        }

        refreshPreview();
      };
    }

    // Universal onConnectionsChange — refreshes inject/assembler previews on any link change
    type ConnectionsChangeHandler = (...args: [number, number, boolean, unknown, unknown]) => void;
    const origConn = (nodeType.prototype as Record<string, ConnectionsChangeHandler | undefined>)[
      "onConnectionsChange"
    ];
    nodeType.prototype.onConnectionsChange = function (
      this: ComfyNode,
      type: number,
      slotIndex: number,
      isConnected: boolean,
      linkInfo: unknown,
      ioSlot: unknown,
    ) {
      origConn?.call(this, type, slotIndex, isConnected, linkInfo, ioSlot);

      const self = this as ComfyNode & {
        _wpRefreshPreview?: () => void;
        _wpRefreshInject?: () => void;
      };

      self._wpRefreshInject?.();
      self._wpRefreshPreview?.();

      try {
        for (const asm of findDownstreamAssemblers(this)) {
          (asm as ComfyNode & { _wpRefreshPreview?: () => void })._wpRefreshPreview?.();
        }
      } catch {
      }
    };
  },
});
