/** @type {import('next').NextConfig} */
const isStaticExport = process.env.NEXT_OUTPUT === "export";

class StripCssBomPlugin {
    apply(compiler) {
        compiler.hooks.thisCompilation.tap("StripCssBomPlugin", (compilation) => {
            compilation.hooks.processAssets.tap(
                {
                    name: "StripCssBomPlugin",
                    stage: compiler.webpack.Compilation.PROCESS_ASSETS_STAGE_OPTIMIZE,
                },
                (assets) => {
                    for (const [filename, asset] of Object.entries(assets)) {
                        if (!filename.endsWith(".css")) continue;

                        const source = asset.source().toString();
                        if (!source.includes("\uFEFF")) continue;

                        compilation.updateAsset(
                            filename,
                            new compiler.webpack.sources.RawSource(source.replaceAll("\uFEFF", "")),
                        );
                    }
                },
            );
        });
    }
}

const nextConfig = {
    reactStrictMode: true,
    agentRules: false,
    poweredByHeader: false,
    compress: true,
    outputFileTracingRoot: __dirname,
    sassOptions: {
        // Prevent Sass from inserting a BOM between concatenated CSS modules.
        charset: false,
    },
    // Locally the API runs on its own port; proxying keeps it same-origin so the
    // HttpOnly session cookie works exactly as behind Caddy in production.
    ...(process.env.NODE_ENV === "development" && !isStaticExport
        ? {
              async rewrites() {
                  const target = (process.env.API_PROXY_TARGET || "http://localhost:3001").replace(
                      /\/$/,
                      "",
                  );
                  return [{ source: "/api/:path*", destination: `${target}/api/:path*` }];
              },
          }
        : {}),
    webpack: (config, { isServer }) => {
        if (!isServer) config.plugins.push(new StripCssBomPlugin());
        return config;
    },
    ...(isStaticExport
        ? {
              output: "export",
              trailingSlash: true,
              images: {
                  unoptimized: true,
              },
          }
        : {
              output: "standalone",
              images: {
                  formats: ["image/avif", "image/webp"],
                  minimumCacheTTL: 60 * 60 * 24 * 30,
              },
          }),
};

module.exports = nextConfig;
