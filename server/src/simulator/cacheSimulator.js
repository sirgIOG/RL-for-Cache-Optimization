import { getVictimIndex } from "./policies.js";
import { resolveRlAction } from "../services/rlPolicyBridge.js";

class PolicyCache {
  constructor(capacity, policyName) {
    this.capacity = capacity;
    this.policyName = policyName;
    this.entries = new Map();
    this.order = [];
    this.tick = 0;
    this.hits = 0;
    this.misses = 0;
    this.evictions = 0;
    this.timeline = [];
  }

  buildState(requested) {
    const cacheLines = new Array(this.capacity).fill(0);
    const accessCounts = new Array(this.capacity).fill(0);
    const lastAccess = new Array(this.capacity).fill(0);

    this.order.forEach((address, index) => {
      const entry = this.entries.get(address);
      cacheLines[index] = address;
      accessCounts[index] = entry.count;
      lastAccess[index] = entry.last;
    });

    return {
      cacheLines,
      accessCounts,
      lastAccess,
      requested,
      currentTick: this.tick,
      occupancy: this.order.length / this.capacity,
    };
  }

  touch(address) {
    const entry = this.entries.get(address);
    if (!entry) {
      return;
    }

    entry.count += 1;
    entry.last = this.tick;

    if (this.policyName === "LRU" || this.policyName === "MRU" || this.policyName === "RL") {
      this.order = this.order.filter((value) => value !== address);
      this.order.push(address);
    }
  }

  insert(address) {
    this.entries.set(address, { count: 1, last: this.tick });
    this.order.push(address);
  }

  evictAt(index) {
    const address = this.order[index];
    if (address === undefined) {
      return;
    }
    this.entries.delete(address);
    this.order.splice(index, 1);
    this.evictions += 1;
  }

  async step(address) {
    this.tick += 1;

    if (this.entries.has(address)) {
      this.hits += 1;
      this.touch(address);
    } else {
      this.misses += 1;

      if (this.order.length >= this.capacity) {
        const victimIndex = await getVictimIndex(
          this.policyName,
          this.buildState(address),
          (state) => resolveRlAction(state, this.capacity)
        );
        this.evictAt(Math.min(victimIndex, this.order.length - 1));
      }

      this.insert(address);
    }

    const step = this.hits + this.misses;
    this.timeline.push({
      step,
      hitRate: this.hits / Math.max(step, 1),
      hits: this.hits,
      misses: this.misses,
    });
  }

  getMetrics() {
    const total = this.hits + this.misses;
    return {
      hitRate: this.hits / Math.max(total, 1),
      hitCount: this.hits,
      missCount: this.misses,
      evictions: this.evictions,
      averageLatency: ((this.hits * 1) + (this.misses * 10)) / Math.max(total, 1),
      timeline: this.timeline,
    };
  }
}

export async function simulatePolicies(accesses, capacity, policies) {
  const caches = Object.fromEntries(policies.map((policy) => [policy, new PolicyCache(capacity, policy)]));

  for (const address of accesses) {
    for (const policy of policies) {
      await caches[policy].step(address);
    }
  }

  return Object.fromEntries(policies.map((policy) => [policy, caches[policy].getMetrics()]));
}
