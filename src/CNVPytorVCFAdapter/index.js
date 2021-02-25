import {
  ConfigurationSchema,
  readConfObject,
} from "@jbrowse/core/configuration";
import { openLocation } from "@jbrowse/core/util/io";
import { ObservableCreate } from "@jbrowse/core/util/rxjs";
import AbortablePromiseCache from "abortable-promise-cache";
import SimpleFeature from "@jbrowse/core/util/simpleFeature";
import { Partition } from "./MeanShift";
import { GetFit } from "./util";

function getMean(data) {
  return (
    data.reduce(function(a, b) {
      return a + b;
    }) / data.length
  );
}

function getSD(data) {
  let m = getMean(data);
  return Math.sqrt(
    data.reduce(function(sq, n) {
      return sq + (n - m) * (n - m);
    }, 0) /
      (data.length - 1),
  );
}

function test_method(bins, globalAverage, globalSd) {
  var formatted_array = [];
  for (var i = 0; i < bins.length; i++) {
    if (bins[i]) {
      formatted_array.push(bins[i].gc_corrected);
    } else {
      formatted_array.push(0);
    }
  }

  var partition = new Partition(formatted_array, globalAverage, globalSd);
  var partition_array = partition.call_mean_shift();
  var caller_array = partition.cnv_calling();

  bins.forEach((bin, index) => {
    bin.corrected_mean = partition_array[index];
    bin.call_score = caller_array[index];
  });
  return 0;
}

export function adapterFactory(pluginManager) {
  const VCFPlugin = pluginManager.getPlugin("VariantsPlugin");
  const LRU = pluginManager.lib["@jbrowse/core/util/QuickLRU"].default;
  const { unzip } = pluginManager.lib["@gmod/bgzf-filehandle"];
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

      this.featureCache = new AbortablePromiseCache({
        cache: new LRU({
          maxSize: 20,
        }),
        fill: this._readChunk.bind(this),
      });
    }

    async parseGC() {
      const gcConfig = readConfObject(this.config, "gcContent");
      const gcLocation = openLocation(gcConfig);
      const text = await gcLocation.readFile("utf8");
      const refs = {};
      text.split("\n").forEach(row => {
        if (row.trim() !== "") {
          const [refName, start, gcContent, gcCount, atCount] = row.split("\t");
          if (!refs[refName]) {
            refs[refName] = [];
          }
          refs[refName].push({
            start: +start,
            gcContent: +gcContent,
            gcCount: +gcCount,
            atCount: +atCount,
          });
        }
      });
      return refs;
    }

    getFeatures(region) {
      return ObservableCreate(async observer => {
        try {
          console.log("calculating");
          const { bins, average } = await this.featureCache.get(
            region.refName,
            region,
          );
          console.log({ bins });
          bins.forEach(feature => {
            if (feature.end > region.start && feature.start < region.end) {
              observer.next(
                new SimpleFeature({
                  data: Object.assign(Object.create(feature), {
                    score: feature.bin_score,
                    source: "sample",
                  }),
                }),
              );
            }
          });

          observer.complete();
        } catch (e) {
          observer.error(e);
        }
      });
    }

    async getAvgAndSD() {
      const gc = await this.parseGC();
      let binSize = 10000;
      let binFactor = 100000 / binSize;
      const gcContent = {};
      const sample = readConfObject(this.config, "sampleIndex");
      const parser = await this.setup();
      const samples = parser.samples;

      const vcfLoc = openLocation(readConfObject(this.config, "vcfGzLocation"));
      const results = await vcfLoc.readFile();
      const textDecoder = new TextDecoder("utf-8");
      const buffer = await unzip(results);
      if (buffer.length > 500000000) {
        throw new Error(
          "Buffer to big to process by this program at this time. We are working on line-by-line buffering. Please email us for more information",
        );
      }
      const lines = textDecoder.decode(buffer);
      let scores = [];
      let chrbin_score = [];
      let feature_score = [];
      lines.split("\n").forEach(line => {
        if (line.startsWith("#") || line == "") {
          return;
        }
        const fields = line.split("\t");
        const format = fields[8].split(":");
        const DP = format.indexOf("DP");
        const score = +fields[9 + sample].split(":")[DP];
        scores.push(score);

        // let refName = fields[0].replace("chr", "");
        let refName = fields[0];
        const start = fields[1];
        //const sampleName = samples[sample];
        const featureBin = Math.max(Math.floor(start / binSize), 0);

        if (!chrbin_score[refName]) {
          chrbin_score[refName] = [];
        }
        if (!chrbin_score[refName][featureBin]) {
          chrbin_score[refName][featureBin] = [];
        }
        chrbin_score[refName][featureBin].push(score);
      });

      var avgbin = [];
      for (let chr in chrbin_score) {
        if (!avgbin[chr]) {
          avgbin[chr] = [];
        }
        for (let k = 0; k < chrbin_score[chr].length / binFactor; k++) {
          for (var j = k * 10; j < 10 * k + 10; j++) {
            if (chrbin_score[chr][j]) {
              const featureBin = Math.max(Math.floor(j / binFactor), 0);

              if (!avgbin[chr][k]) {
                avgbin[chr][k] = { bin_score: 0 };
              }

              avgbin[chr][k].start = featureBin * binSize * binFactor;
              avgbin[chr][k].end = (featureBin + 1) * binSize * binFactor;
              var tmp_score = parseInt(getMean(chrbin_score[chr][j])) * 100;
              avgbin[chr][k].bin_score += tmp_score;
              avgbin[chr][k].source = samples[sample];
            }
          }

          if (avgbin[chr][k]) {
            let chrGC = gc[chr];
            const gcVal = chrGC[k].gcContent;
            if (!gcContent[gcVal]) {
              gcContent[gcVal] = [];
            }
            gcContent[gcVal].push(avgbin[chr][k].bin_score);
          }
        }
      }

      // get curve_fit values
      var fit_info = new GetFit(avgbin);
      // var max_rd = fit_info.max_rd();
      var [fit, max_rd] = fit_info.fit_data();

      for (const gc in gcContent) {
        var raw_gc = gcContent[gc].filter(x => x > 0 && x < max_rd);
        const gcMean = getMean(raw_gc);
        gcContent[gc] = gcMean / fit.mean;
      }

      var bins = [];
      bins = avgbin;
      for (const chr in bins) {
        let chrGC = gc[chr];
        bins[chr].forEach(sample => {
          const start = sample.start;
          const featureBin = Math.max(
            Math.floor(start / (binSize * binFactor)),
            0,
          );
          const gcVal = chrGC[featureBin] ? chrGC[featureBin].gcContent : 0;

          const meanScoreForGcBin = gcContent[gcVal];
          if (sample.bin_score == 0) {
            sample.gc_corrected = 0;
          } else {
            sample.gc_corrected = sample.bin_score * (1 / meanScoreForGcBin);
          }
        });
      }

      var fit_info_gc = new GetFit(bins);
      var [fit, max_rd] = fit_info_gc.fit_data("gc");
      return { mean: fit.mean, sd: fit.sigma, gcRD: gcContent };
    }

    async _readChunk(query) {
      const parser = await this.setup();
      const samples = parser.samples;
      const gc = await this.parseGC();
      const gcContent = {};
      let globalAverage;
      let globalSd;
      let globalgcRD;

      const { mean, sd, gcRD } = await this.getAvgAndSD(this.sample);
      globalAverage = mean;
      globalSd = sd;
      globalgcRD = gcRD;

      const regularizedReferenceName = this.browser.regularizeReferenceName(
        query.ref,
      );

      // let binSize = 100000;

      let binSize = 10000;
      let binFactor = 100000 / binSize;

      var bins = [];

      // const refName = query.ref.replace("chr", "");
      const chrGc = gc[regularizedReferenceName];
      await this.indexedData.getLines(
        regularizedReferenceName,
        0,
        undefined,
        (line, fileOffset) => {
          const fields = line.split("\t");
          const start = +fields[1];
          const format = fields[8].split(":");
          const DP = format.indexOf("DP");
          const featureBin = Math.max(Math.floor((start - 1) / binSize), 0);

          if (!bins[featureBin]) {
            bins[featureBin] = { sum_score: 0, bin_score: 0, count: 0 };
          }
          bins[featureBin].start = featureBin * binSize;
          bins[featureBin].end = (featureBin + 1) * binSize;
          bins[featureBin].id = fileOffset;
          const sampleName = samples[this.sample];
          const score = +fields[9 + this.sample].split(":")[DP];
          const finalScore = isNaN(score) ? 0 : score;
          bins[featureBin].sum_score += finalScore;
          bins[featureBin].count++;
          bins[featureBin].source = sampleName;
        },
      );

      var avgbin = [];
      for (let k = 0; k < bins.length / binFactor; k++) {
        if (!avgbin[k]) {
          avgbin[k] = {
            bin_score: 0,
            gc_corrected: 0,
            corrected_mean: 0,
            call_score: 0,
          };
        }

        for (var j = k * 10; j < 10 * k + 10; j++) {
          if (bins[j]) {
            const featureBin = Math.max(
              Math.floor(bins[j].start / (binSize * binFactor)),
              0,
            );

            avgbin[k].start = featureBin * binSize * binFactor;
            avgbin[k].end = (featureBin + 1) * binSize * binFactor;

            var tmp_score = parseInt(bins[j].sum_score / bins[j].count) * 100;
            avgbin[k].bin_score += tmp_score;
            avgbin[k].source = bins[j].source;
            avgbin[k].id = bins[j].id;
          }
        }
      }
      bins = [];
      bins = avgbin;

      bins.forEach(sample => {
        sample.bin_score = sample.bin_score;
        const start = sample.start;
        const featureBin = Math.max(
          Math.floor(start / (binSize * binFactor)),
          0,
        );

        const gcVal = chrGc[featureBin] ? chrGc[featureBin].gcContent : 0;

        const meanScoreForGcBin = globalgcRD[gcVal];
        if (sample.bin_score == 0) {
          sample.gc_corrected = 0;
        } else {
          sample.gc_corrected = sample.bin_score * (1 / meanScoreForGcBin);
        }
      });

      await test_method(bins, globalAverage, globalSd);

      const results = {
        average: globalAverage,
        bins,
      };
      return results;
    }
  }

  return { AdapterClass, configSchema };
}
