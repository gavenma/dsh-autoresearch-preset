# Should we adopt WebGPU for the data-viz product?

## Objective

Decide whether to invest in migrating the interactive data-viz product from a
WebGL2-based renderer to WebGPU over the next two quarters.

## Context

- The product renders up to 500k points / 20k shapes per frame on desktop.
- Current stack: WebGL2, custom shaders, TypeScript.
- Browser support policy: last two versions of Chrome, Edge, Firefox, Safari.
- Team: 3 frontend engineers, ~2 quarters of roadmap slack.
- Fallback needs: integrated GPUs, corporate-managed browsers, older Windows.

## Success criteria for the recommendation

1. A clear recommendation: adopt now / adopt later / do not adopt.
2. Evidence-grounded performance and ecosystem claims, with sources.
3. Browser-support and fallback risks quantified.
4. A migration-cost estimate with staged options.
