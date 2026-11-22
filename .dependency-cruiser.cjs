/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'utils-no-third-party-runtime-dependencies',
      severity: 'error',
      comment: 'Dependency-free utilities may import only Node built-ins and local source files.',
      from: {
        path: '^(packages/(utils|server-utils)/dist|test/fixtures/dependency-cruiser)',
      },
      to: {
        pathNot: '^(node:|\\.)',
        dependencyTypes: ['npm', 'npm-dev', 'npm-optional', 'npm-peer'],
      },
    },
    {
      name: 'utils-no-node-builtins',
      severity: 'error',
      comment:
        'Portable utilities must not import Node built-ins. Server-only code belongs in @vouchington/server-utils.',
      from: { path: '^(packages/utils/dist|test/fixtures/dependency-cruiser/utils-)' },
      to: { dependencyTypes: ['core'] },
    },
    {
      name: 'no-circular',
      severity: 'error',
      comment: 'Circular dependencies make modules hard to reason about and test in isolation.',
      from: {},
      to: { circular: true },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'node', 'default'],
    },
    reporterOptions: {
      text: { highlightFocused: true },
    },
  },
}
