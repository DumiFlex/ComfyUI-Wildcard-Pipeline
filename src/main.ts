import { app } from "#comfyui/app";
import type {
  ComfyNode,
  ComfyWidget,
  ComfyNodeType,
  ComfyNodeData,
} from "#comfyui/app";
import { createPipelineWidget, createAssemblerWidget } from "./extension/widgets";

app.registerExtension({
  name: "wildcard-pipeline",

  getCustomWidgets() {
    return {
      PIPELINE_MODULES(node: ComfyNode, inputName: string) {
        return createPipelineWidget(node, inputName);
      },
      ASSEMBLER_TEMPLATE(node: ComfyNode, inputName: string) {
        return createAssemblerWidget(node, inputName);
      },
    };
  },

  async beforeRegisterNodeDef(nodeType: ComfyNodeType, nodeData: ComfyNodeData) {
    if (nodeData.name === "WP_WildcardPipeline") {
      const origOnCreated = nodeType.prototype.onNodeCreated;
      nodeType.prototype.onNodeCreated = function (this: ComfyNode, ...args: unknown[]) {
        origOnCreated?.apply(this, args);
        const moduleWidget = this.widgets?.find(
          (w: ComfyWidget) => w.name === "module_config"
        );
        if (moduleWidget) {
          moduleWidget.type = "PIPELINE_MODULES";
        }
      };
    }

    if (nodeData.name === "WP_PromptAssembler") {
      const origOnCreated = nodeType.prototype.onNodeCreated;
      nodeType.prototype.onNodeCreated = function (this: ComfyNode, ...args: unknown[]) {
        origOnCreated?.apply(this, args);
        const templateWidget = this.widgets?.find(
          (w: ComfyWidget) => w.name === "template"
        );
        if (templateWidget) {
          templateWidget.type = "ASSEMBLER_TEMPLATE";
        }
      };
    }
  },
});
