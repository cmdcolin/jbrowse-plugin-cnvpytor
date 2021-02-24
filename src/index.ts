import AdapterType from "@jbrowse/core/pluggableElementTypes/AdapterType";
import Plugin from "@jbrowse/core/Plugin";
import { adapterFactory, configSchema } from "./CNVPytorVCFAdapter";
import { version } from "../package.json";

export default class UCSCPlugin extends Plugin {
  name = "CNVPytor";
  version = version;
  install(pluginManager: any) {
    const AdapterClass = adapterFactory(pluginManager);
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
