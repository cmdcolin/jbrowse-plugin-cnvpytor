import AdapterType from "@jbrowse/core/pluggableElementTypes/AdapterType";
import Plugin from "@jbrowse/core/Plugin";
import { adapterFactory } from "./CNVPytorVCFAdapter";
import { version } from "../package.json";

export default class CNVPytorPlugin extends Plugin {
  name = "CNVPytor";
  version = version;
  install(pluginManager: any) {
    const { configSchema, AdapterClass } = adapterFactory(pluginManager);
    pluginManager.addAdapterType(
      () =>
        new AdapterType({
          name: "CNVPytorVCFAdapter",
          configSchema,
          //@ts-ignore
          AdapterClass,
        }),
    );
  }
}
