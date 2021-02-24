import {
  ConfigurationSchema,
  readConfObject,
} from "@jbrowse/core/configuration";
import { ObservableCreate } from "@jbrowse/core/util/rxjs";
import { BaseFeatureDataAdapter } from "@jbrowse/core/data_adapters/BaseAdapter";
import SimpleFeature from "@jbrowse/core/util/simpleFeature";
import stringify from "json-stable-stringify";

export const configSchema = ConfigurationSchema(
  "CNVPytorVCFAdapter",
  {
    vcf: {
      type: "fileLocation",
      defaultValue: { uri: "/path/to/file.vcf.gz" },
    },
    sampleIndex: {
      type: "number",
      defaultValue: 0,
    },
  },
  { explicitlyTyped: true },
);

export function adapterFactory(pluginManager) {
  const VCFPlugin = pluginManager.getPlugin("VariantsPlugin");
  const { VcfTabixAdapterClass } = VCFPlugin.exports;

  return class AdapterClass extends VcfTabixAdapterClass {
    constructor(config) {
      super(config);
      this.config = config;
    }

    getFeatures(region) {
      const { assemblyName, start, end, refName } = region;
      return ObservableCreate(async observer => {
        try {
          console.log("here", start, end, refName);
          observer.complete();
        } catch (e) {
          observer.error(e);
        }
      });
    }

    async getRefNames() {
      const arr = [];
      for (let i = 0; i < 23; i++) {
        arr.push(`chr${i}`);
      }
      return arr;
    }

    freeResources() {}
  };
}
