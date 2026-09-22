/**
 * Infrastructure Difference Detector
 *
 * Compares two normalized infrastructure profiles (see inspector.js) across
 * fixed dimensions: Storage, Platform, Compute, Network, ResourceQuotas,
 * LimitRanges, Availability.
 *
 * For identical infrastructure profiles, returns zero differences across
 * every dimension. Operates purely on data already provided -- never
 * initiates live Kubernetes calls itself.
 */
'use strict';

const DIMENSIONS = ['Storage', 'Platform', 'Compute', 'Network', 'ResourceQuotas', 'LimitRanges', 'Availability'];

function sortByName(list) {
  return [...(list || [])].sort((a, b) => String(a.name).localeCompare(String(b.name)));
}

function deepEqual(a, b) {
  return JSON.stringify(normalizeForCompare(a)) === JSON.stringify(normalizeForCompare(b));
}

function normalizeForCompare(value) {
  if (Array.isArray(value)) {
    return value.map(normalizeForCompare).sort((x, y) => JSON.stringify(x).localeCompare(JSON.stringify(y)));
  }
  if (value && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value).sort()) {
      out[key] = normalizeForCompare(value[key]);
    }
    return out;
  }
  return value;
}

function compareStorage(a, b) {
  const scA = sortByName(a.storageClasses);
  const scB = sortByName(b.storageClasses);
  const equal = deepEqual(scA, scB);
  return {
    dimension: 'Storage',
    differenceFound: !equal,
    detail: equal ? {} : { infrastructureA: scA, infrastructureB: scB },
  };
}

function comparePlatform(a, b) {
  const equal = a.kubernetesVersion === b.kubernetesVersion;
  return {
    dimension: 'Platform',
    differenceFound: !equal,
    detail: equal ? {} : { kubernetesVersionA: a.kubernetesVersion, kubernetesVersionB: b.kubernetesVersion },
  };
}

function compareCompute(a, b) {
  const nodesA = sortByName(a.nodes);
  const nodesB = sortByName(b.nodes);
  const nodesEqual = deepEqual(nodesA, nodesB);

  // Also compare container-level resource limits/requests.
  // These are set per-deployment and represent the Kubernetes-enforced cgroup boundaries.
  // A difference here (e.g. CPU limit 2000m vs 200m) is a genuine, kernel-enforced
  // infrastructure difference that the application workload will observe as latency variation.
  const crA = a.containerResources || null;
  const crB = b.containerResources || null;
  const resourcesEqual = deepEqual(crA, crB);

  const equal = nodesEqual && resourcesEqual;

  const detail = {};
  if (!nodesEqual) {
    detail.nodesA = nodesA;
    detail.nodesB = nodesB;
  }
  if (!resourcesEqual) {
    detail.containerResourcesA = crA;
    detail.containerResourcesB = crB;
  }

  return {
    dimension: 'Compute',
    differenceFound: !equal,
    detail: equal ? {} : detail,
  };
}


function compareNetwork(a, b) {
  const npA = normalizeForCompare(a.networkPolicies);
  const npB = normalizeForCompare(b.networkPolicies);
  const servicesA = normalizeForCompare(a.services);
  const servicesB = normalizeForCompare(b.services);
  const ingressA = normalizeForCompare(a.ingressClasses);
  const ingressB = normalizeForCompare(b.ingressClasses);
  const equal =
    JSON.stringify(npA) === JSON.stringify(npB) &&
    JSON.stringify(servicesA) === JSON.stringify(servicesB) &&
    JSON.stringify(ingressA) === JSON.stringify(ingressB);
  return {
    dimension: 'Network',
    differenceFound: !equal,
    detail: equal
      ? {}
      : {
          networkPoliciesA: npA,
          networkPoliciesB: npB,
          servicesA,
          servicesB,
          ingressClassesA: ingressA,
          ingressClassesB: ingressB,
        },
  };
}

function compareResourceQuotas(a, b) {
  const equal = deepEqual(a.resourceQuotas, b.resourceQuotas);
  return {
    dimension: 'ResourceQuotas',
    differenceFound: !equal,
    detail: equal ? {} : { resourceQuotasA: a.resourceQuotas, resourceQuotasB: b.resourceQuotas },
  };
}

function compareLimitRanges(a, b) {
  const equal = deepEqual(a.limitRanges, b.limitRanges);
  return {
    dimension: 'LimitRanges',
    differenceFound: !equal,
    detail: equal ? {} : { limitRangesA: a.limitRanges, limitRangesB: b.limitRanges },
  };
}

function compareAvailability(a, b) {
  const equal = a.availability === b.availability;
  return {
    dimension: 'Availability',
    differenceFound: !equal,
    detail: equal ? {} : { availabilityA: a.availability, availabilityB: b.availability },
  };
}

/**
 * @param {object} profileA - normalized infrastructure profile for Infrastructure A
 * @param {object} profileB - normalized infrastructure profile for Infrastructure B
 * @returns {Array<{dimension:string, differenceFound:boolean, detail:object}>}
 */
function detectDifferences(profileA, profileB) {
  if (!profileA || !profileB) {
    throw new Error('detectDifferences requires two normalized infrastructure profiles');
  }
  return [
    compareStorage(profileA, profileB),
    comparePlatform(profileA, profileB),
    compareCompute(profileA, profileB),
    compareNetwork(profileA, profileB),
    compareResourceQuotas(profileA, profileB),
    compareLimitRanges(profileA, profileB),
    compareAvailability(profileA, profileB),
  ];
}

module.exports = { detectDifferences, DIMENSIONS };
