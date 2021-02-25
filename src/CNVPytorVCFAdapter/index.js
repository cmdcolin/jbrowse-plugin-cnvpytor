import {
  ConfigurationSchema,
  readConfObject,
} from "@jbrowse/core/configuration";
import { openLocation } from "@jbrowse/core/util/io";
import { ObservableCreate } from "@jbrowse/core/util/rxjs";
import AbortablePromiseCache from "abortable-promise-cache";
import SimpleFeature from "@jbrowse/core/util/simpleFeature";
import { toArray } from "rxjs/operators";

export function adapterFactory(pluginManager) {
  const VCFPlugin = pluginManager.getPlugin("VariantsPlugin");
  const LRU = pluginManager.lib["@jbrowse/core/util/QuickLRU"].default;
  const {
    vcfTabixAdapterConfigSchema,
    VcfTabixAdapterClass,
  } = VCFPlugin.exports;

  const configSchema = ConfigurationSchema(
    "CNVPytorVCFAdapter",
    {
      sampleIndex: {
        type: "number",
        defaultValue: 0,
      },
      gcContent: {
        type: "fileLocation",
        defaultValue: { uri: "data/hg38.10000.gc" },
      },
    },
    { baseConfiguration: vcfTabixAdapterConfigSchema, explicitlyTyped: true },
  );

  class AdapterClass extends VcfTabixAdapterClass {
    constructor(config) {
      super(config);
      this.config = config;
    }

    getFeatures(region) {
      const superGetFeatures = super.getFeatures;
      return ObservableCreate(async observer => {
        try {
          const feats = await superGetFeatures
            .call(this, region)
            .pipe(toArray())
            .toPromise();
          feats.forEach(feat => {
            const samples = feat.get("samples");
            const sampleNames = Object.keys(samples);
            observer.next(
              new SimpleFeature({
                start: feat.get("start"),
                end: feat.get("end"),
                uniqueId: feat.id(),
                score: samples[sampleNames[0]].DP[0],
              }),
            );
          });

          observer.complete();
        } catch (e) {
          observer.error(e);
        }
      });
    }
  }

  return { AdapterClass, configSchema };
}
