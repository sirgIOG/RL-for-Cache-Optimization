import json
import lzma
import math
import random
import shutil
import urllib.request
from collections import OrderedDict, defaultdict, deque
from pathlib import Path
from struct import Struct

import numpy as np
import torch
import torch.nn as nn
import torch.optim as optim


SEED = 42
random.seed(SEED)
np.random.seed(SEED)
torch.manual_seed(SEED)
if torch.cuda.is_available():
    torch.cuda.manual_seed_all(SEED)

DEVICE = torch.device("cuda" if torch.cuda.is_available() else "cpu")

# Official DPC-3 public ChampSim traces.
# Source directory:
# https://dpc3.compas.cs.stonybrook.edu/champsim-traces/speccpu/
TRACE_SPLITS = {
    "train": [
        "https://dpc3.compas.cs.stonybrook.edu/champsim-traces/speccpu/602.gcc_s-734B.champsimtrace.xz",
        "https://dpc3.compas.cs.stonybrook.edu/champsim-traces/speccpu/605.mcf_s-484B.champsimtrace.xz",
        "https://dpc3.compas.cs.stonybrook.edu/champsim-traces/speccpu/620.omnetpp_s-141B.champsimtrace.xz",
    ],
    "val": [
        "https://dpc3.compas.cs.stonybrook.edu/champsim-traces/speccpu/623.xalancbmk_s-165B.champsimtrace.xz",
    ],
    "test": [
        "https://dpc3.compas.cs.stonybrook.edu/champsim-traces/speccpu/619.lbm_s-2676B.champsimtrace.xz",
    ],
}

CONFIG = {
    "capacity": 16,
    "episode_len": 4096,
    "skip_instructions": 50_000,
    "max_instructions_per_trace": 300_000,
    "clean_start": False,
    "warmstart_epochs": 4,
    "warmstart_batch_size": 256,
    "warmstart_lr": 1e-3,
    "rl_epochs": 8,
    "replay_size": 200_000,
    "batch_size": 256,
    "rl_lr": 1e-4,
    "gamma": 0.95,
    "tau": 0.002,
    "eps_start": 1.0,
    "eps_min": 0.05,
    "eps_decay": 120_000,
    "data_dir": "data/champsim",
    "processed_dir": "data/processed",
    "model_dir": "models",
    "report_path": "models/training_report.json",
}

# Official ChampSim input_instr layout:
# https://raw.githubusercontent.com/ChampSim/ChampSim/master/inc/trace_instruction.h
# struct input_instr {
#   unsigned long long ip;
#   unsigned char is_branch;
#   unsigned char branch_taken;
#   unsigned char destination_registers[2];
#   unsigned char source_registers[4];
#   unsigned long long destination_memory[2];
#   unsigned long long source_memory[4];
# };
TRACE_RECORD = Struct("<QBB2B4B2Q4Q")
CACHE_LINE_SHIFT = 6


def prepare_run_directories(config):
    if not config["clean_start"]:
        return

    for path_str in (config["processed_dir"], config["model_dir"]):
        path = Path(path_str)
        if path.exists():
            shutil.rmtree(path)


def ensure_dirs(config):
    for path_str in (config["data_dir"], config["processed_dir"], config["model_dir"]):
        Path(path_str).mkdir(parents=True, exist_ok=True)


def safe_name_from_url(url):
    return url.rsplit("/", 1)[-1].replace(".champsimtrace.xz", "")


def snapshot_state(cache, tick, req, capacity):
    keys = list(cache.keys())
    counts = [cache[k]["count"] for k in keys]
    ticks = [cache[k]["last"] for k in keys]

    pad = capacity - len(keys)
    keys += [0] * pad
    counts += [0] * pad
    ticks += [0] * pad

    return {
        "cache_lines": np.array(keys, dtype=np.int64),
        "access_counts": np.array(counts, dtype=np.float32),
        "last_access": np.array(ticks, dtype=np.float32),
        "requested": float(req),
        "current_tick": float(tick),
        "occupancy": float(len(cache) / capacity),
    }


def iter_champsim_records(url, skip_instructions, max_instructions):
    """
    Stream-decompress a ChampSim trace and yield memory accesses at cache-line granularity.
    This avoids downloading the full trace file in Colab.
    """

    processed = 0
    yielded = 0
    accesses = []

    with urllib.request.urlopen(url) as response:
        with lzma.LZMAFile(response, "rb") as f:
            while processed < max_instructions:
                raw = f.read(TRACE_RECORD.size)
                if len(raw) < TRACE_RECORD.size:
                    break

                processed += 1
                fields = TRACE_RECORD.unpack(raw)
                if processed <= skip_instructions:
                    continue

                dst_mem = fields[9:11]
                src_mem = fields[11:15]

                # Feed loads first, then stores, ignoring zeros.
                mem_ops = [addr for addr in src_mem if addr != 0]
                mem_ops.extend(addr for addr in dst_mem if addr != 0)

                for addr in mem_ops:
                    accesses.append(int(addr) >> CACHE_LINE_SHIFT)
                    yielded += 1

    return accesses, processed, yielded


def load_or_stream_trace(url, config):
    processed_dir = Path(config["processed_dir"])
    stem = safe_name_from_url(url)
    out_path = processed_dir / f"{stem}.npy"
    meta_path = processed_dir / f"{stem}.json"

    if out_path.exists() and meta_path.exists():
        arr = np.load(out_path)
        with open(meta_path, "r", encoding="utf-8") as f:
            meta = json.load(f)
        print(f"Loaded cached trace {stem}: {len(arr)} accesses")
        return [int(x) for x in arr.tolist()], meta

    print(f"Streaming trace {stem} ...")
    accesses, processed, yielded = iter_champsim_records(
        url=url,
        skip_instructions=config["skip_instructions"],
        max_instructions=config["max_instructions_per_trace"],
    )

    if not accesses:
        raise RuntimeError(f"No accesses extracted from {url}")

    np.save(out_path, np.array(accesses, dtype=np.int64))
    meta = {
        "url": url,
        "instructions_processed": processed,
        "memory_accesses_extracted": yielded,
        "cache_lines_saved": len(accesses),
    }
    with open(meta_path, "w", encoding="utf-8") as f:
        json.dump(meta, f, indent=2)

    print(
        f"Cached {stem}: "
        f"{processed} instructions, {yielded} accesses, {len(accesses)} cache-line references"
    )
    return accesses, meta


def split_trace_into_episodes(trace, episode_len):
    return [trace[i : i + episode_len] for i in range(0, len(trace) - episode_len + 1, episode_len)]


def build_datasets(config):
    split_data = {}
    split_meta = {}

    for split_name, urls in TRACE_SPLITS.items():
        episodes = []
        metas = []
        for url in urls:
            accesses, meta = load_or_stream_trace(url, config)
            trace_episodes = split_trace_into_episodes(accesses, config["episode_len"])
            if not trace_episodes:
                raise RuntimeError(f"Trace {url} did not produce enough accesses for one episode.")
            episodes.extend(trace_episodes)
            metas.append(meta)

        split_data[split_name] = episodes
        split_meta[split_name] = metas

    if not split_data["train"] or not split_data["val"] or not split_data["test"]:
        raise RuntimeError("One or more splits are empty after trace processing.")

    rng = random.Random(SEED)
    for split_name in split_data:
        rng.shuffle(split_data[split_name])

    return split_data["train"], split_data["val"], split_data["test"], split_meta


class CacheEnv:
    """
    Project-compatible RL environment.
    cache_lines are ordered oldest->newest by recency.
    Action = victim index in that ordered list.
    """

    def __init__(self, capacity):
        self.capacity = capacity
        self.reset()

    def reset(self):
        self.cache = OrderedDict()
        self.tick = 0
        self.hits = 0
        self.misses = 0
        return self.get_state(0)

    def get_state(self, req):
        return snapshot_state(self.cache, self.tick, req, self.capacity)

    def step(self, addr, action):
        self.tick += 1
        hit = addr in self.cache
        reward = 1.0 if hit else -1.0

        if hit:
            self.hits += 1
            self.cache[addr]["count"] += 1
            self.cache[addr]["last"] = self.tick
            self.cache.move_to_end(addr)
        else:
            self.misses += 1
            if len(self.cache) >= self.capacity:
                keys = list(self.cache.keys())
                victim_idx = min(action, len(keys) - 1)
                victim = keys[victim_idx]
                del self.cache[victim]
            self.cache[addr] = {"count": 1, "last": self.tick}

        return self.get_state(addr), reward, hit


class StateBuilder:
    """
    Keep this identical in the project's inference code.
    State layout:
    [line_id_norm | request_delta | counts | recency | occupancy_mask | requested | occupancy | tick]
    """

    def __init__(self, capacity, tick_norm=4096.0, count_norm=32.0, req_mod=65536.0):
        self.capacity = capacity
        self.state_dim = 5 * capacity + 3
        self.tick_norm = float(tick_norm)
        self.count_norm = float(count_norm)
        self.req_mod = float(req_mod)

    def build(self, s):
        cap = self.capacity
        counts = s["access_counts"][:cap].astype(np.float32)
        recency = s["last_access"][:cap].astype(np.float32)
        lines = s["cache_lines"][:cap].astype(np.float32)
        requested_raw = np.float32(s["requested"])

        occ_mask = (lines != 0).astype(np.float32)
        line_id_norm = (((lines % self.req_mod) / self.req_mod) * occ_mask).astype(np.float32)
        request_delta = np.clip((requested_raw - lines) / self.req_mod, -1.0, 1.0).astype(np.float32) * occ_mask
        norm_counts = np.clip(counts / self.count_norm, 0.0, 1.0)
        norm_recency = np.clip(recency / self.tick_norm, 0.0, 1.0)

        requested = (requested_raw % self.req_mod) / self.req_mod
        occupancy = np.float32(s["occupancy"])
        tick = np.clip(s["current_tick"] / self.tick_norm, 0.0, 1.0)

        return np.concatenate(
            [
                line_id_norm,
                request_delta,
                norm_counts,
                norm_recency,
                occ_mask,
                np.array([requested, occupancy, tick], dtype=np.float32),
            ]
        ).astype(np.float32)


class DQN(nn.Module):
    def __init__(self, state_dim, action_dim):
        super().__init__()
        self.net = nn.Sequential(
            nn.Linear(state_dim, 256),
            nn.ReLU(),
            nn.Linear(256, 256),
            nn.ReLU(),
            nn.Linear(256, action_dim),
        )

    def forward(self, x):
        return self.net(x)


class Agent:
    def __init__(self, config):
        self.capacity = config["capacity"]
        self.config = config
        self.sb = StateBuilder(self.capacity)

        self.policy = DQN(self.sb.state_dim, self.capacity).to(DEVICE)
        self.target = DQN(self.sb.state_dim, self.capacity).to(DEVICE)
        self.target.load_state_dict(self.policy.state_dict())

        self.buffer = deque(maxlen=config["replay_size"])
        self.loss_fn = nn.SmoothL1Loss()
        self.batch_size = config["batch_size"]
        self.gamma = config["gamma"]
        self.tau = config["tau"]
        self.eps = config["eps_start"]
        self.eps_min = config["eps_min"]
        self.eps_decay = config["eps_decay"]
        self.steps_done = 0

        self.reset_optimizer(config["rl_lr"])

    def reset_optimizer(self, lr):
        self.opt = optim.Adam(self.policy.parameters(), lr=lr)

    def sync_target(self):
        self.target.load_state_dict(self.policy.state_dict())

    def act(self, state, greedy=False):
        raw = state["cache_lines"]
        valid = np.where(raw != 0)[0]
        if len(valid) == 0:
            return 0

        if not greedy:
            self.steps_done += 1
            self.eps = self.eps_min + (self.config["eps_start"] - self.eps_min) * math.exp(
                -self.steps_done / self.eps_decay
            )
            if random.random() < self.eps:
                return int(np.random.choice(valid))

        x = torch.tensor(self.sb.build(state), dtype=torch.float32, device=DEVICE).unsqueeze(0)
        with torch.no_grad():
            q = self.policy(x).squeeze(0).cpu().numpy()

        masked = np.full(self.capacity, -np.inf, dtype=np.float32)
        masked[valid] = q[valid]
        return int(np.argmax(masked))

    def q_values(self, batch_states):
        return self.policy(batch_states)

    def store(self, s, a, r, ns, done):
        self.buffer.append((self.sb.build(s), int(a), float(r), self.sb.build(ns), float(done)))

    def soft_update_target(self):
        for target_param, policy_param in zip(self.target.parameters(), self.policy.parameters()):
            target_param.data.mul_(1.0 - self.tau).add_(self.tau * policy_param.data)

    def train_step(self):
        if len(self.buffer) < self.batch_size:
            return None

        batch = random.sample(self.buffer, self.batch_size)
        s, a, r, ns, done = zip(*batch)

        s = torch.tensor(np.array(s), dtype=torch.float32, device=DEVICE)
        ns = torch.tensor(np.array(ns), dtype=torch.float32, device=DEVICE)
        a = torch.tensor(a, dtype=torch.long, device=DEVICE)
        r = torch.tensor(r, dtype=torch.float32, device=DEVICE)
        done = torch.tensor(done, dtype=torch.float32, device=DEVICE)

        q = self.policy(s).gather(1, a.unsqueeze(1)).squeeze(1)
        with torch.no_grad():
            next_actions = self.policy(ns).argmax(1, keepdim=True)
            next_q = self.target(ns).gather(1, next_actions).squeeze(1)
            target = r + (1.0 - done) * self.gamma * next_q

        loss = self.loss_fn(q, target)
        self.opt.zero_grad()
        loss.backward()
        torch.nn.utils.clip_grad_norm_(self.policy.parameters(), 1.0)
        self.opt.step()
        self.soft_update_target()
        return float(loss.item())

    def save(self, path, extra_metrics=None):
        payload = {
            "policy_net": self.policy.state_dict(),
            "target_net": self.target.state_dict(),
            "optimizer": self.opt.state_dict(),
            "steps_done": self.steps_done,
            "epsilon": self.eps,
            "metadata": {
                "capacity": self.capacity,
                "state_dim": self.sb.state_dim,
                "state_layout": "line_id_norm|request_delta|counts|recency|occupancy_mask|requested|occupancy|tick",
                "cache_order": "cache_lines ordered oldest->newest by recency; action selects victim index",
                "count_norm": self.sb.count_norm,
                "tick_norm": self.sb.tick_norm,
                "request_mod": self.sb.req_mod,
                "cache_line_shift": CACHE_LINE_SHIFT,
                "trace_record_format": TRACE_RECORD.format,
                "device_trained": str(DEVICE),
            },
        }
        if extra_metrics is not None:
            payload["metrics"] = extra_metrics
        torch.save(payload, path)

    def load(self, path):
        ckpt = torch.load(path, map_location=DEVICE)
        self.policy.load_state_dict(ckpt["policy_net"])
        self.target.load_state_dict(ckpt["target_net"])
        self.opt.load_state_dict(ckpt["optimizer"])
        self.steps_done = ckpt.get("steps_done", 0)
        self.eps = ckpt.get("epsilon", self.eps)


def run_fifo_episode(accesses, capacity):
    cache = OrderedDict()
    hits = 0
    misses = 0
    for addr in accesses:
        if addr in cache:
            hits += 1
        else:
            misses += 1
            if len(cache) >= capacity:
                cache.popitem(last=False)
            cache[addr] = True
    return hits / max(hits + misses, 1)


def run_lru_episode(accesses, capacity):
    cache = OrderedDict()
    hits = 0
    misses = 0
    for addr in accesses:
        if addr in cache:
            hits += 1
            cache.move_to_end(addr)
        else:
            misses += 1
            if len(cache) >= capacity:
                cache.popitem(last=False)
            cache[addr] = True
    return hits / max(hits + misses, 1)


def eval_fifo(episodes, capacity):
    return float(np.mean([run_fifo_episode(ep, capacity) for ep in episodes]))


def eval_lru(episodes, capacity):
    return float(np.mean([run_lru_episode(ep, capacity) for ep in episodes]))


def eval_agent(agent, episodes, capacity):
    hrs = []
    for accesses in episodes:
        env = CacheEnv(capacity)
        state = env.reset()
        for addr in accesses:
            action = agent.act(state, greedy=True)
            next_state, _, _ = env.step(addr, action)
            state = next_state
        hrs.append(env.hits / max(env.hits + env.misses, 1))
    return float(np.mean(hrs))


def collect_oracle_supervision(episodes, capacity, sb):
    """
    Use Belady's farthest-next-use decision as a warm-start label.
    """

    features = []
    labels = []

    for accesses in episodes:
        future_positions = defaultdict(deque)
        for idx, addr in enumerate(accesses):
            future_positions[addr].append(idx)

        cache = OrderedDict()
        tick = 0

        for idx, addr in enumerate(accesses):
            future_positions[addr].popleft()
            state = snapshot_state(cache, tick, addr, capacity)
            tick += 1

            if addr in cache:
                cache[addr]["count"] += 1
                cache[addr]["last"] = tick
                cache.move_to_end(addr)
                continue

            if len(cache) >= capacity:
                keys = list(cache.keys())
                next_uses = []
                for key in keys:
                    if future_positions[key]:
                        next_uses.append(future_positions[key][0])
                    else:
                        next_uses.append(float("inf"))

                victim_idx = int(np.argmax(next_uses))
                features.append(sb.build(state))
                labels.append(victim_idx)
                del cache[keys[victim_idx]]

            cache[addr] = {"count": 1, "last": tick}

    return np.array(features, dtype=np.float32), np.array(labels, dtype=np.int64)


def warmstart_from_oracle(agent, train_episodes, config):
    x, y = collect_oracle_supervision(train_episodes, agent.capacity, agent.sb)
    if len(x) == 0:
        return {"samples": 0, "loss": 0.0}

    optimizer = optim.Adam(agent.policy.parameters(), lr=config["warmstart_lr"])
    loss_fn = nn.CrossEntropyLoss()
    indices = np.arange(len(x))
    last_loss = 0.0

    for _ in range(config["warmstart_epochs"]):
        np.random.shuffle(indices)
        losses = []
        for start in range(0, len(indices), config["warmstart_batch_size"]):
            idx = indices[start : start + config["warmstart_batch_size"]]
            xb = torch.tensor(x[idx], dtype=torch.float32, device=DEVICE)
            yb = torch.tensor(y[idx], dtype=torch.long, device=DEVICE)

            logits = agent.q_values(xb)
            loss = loss_fn(logits, yb)

            optimizer.zero_grad()
            loss.backward()
            torch.nn.utils.clip_grad_norm_(agent.policy.parameters(), 1.0)
            optimizer.step()
            losses.append(float(loss.item()))

        last_loss = float(np.mean(losses)) if losses else 0.0

    agent.sync_target()
    agent.reset_optimizer(config["rl_lr"])
    return {"samples": int(len(x)), "loss": last_loss}


def train_agent(agent, train_episodes, val_episodes, config, best_model_path):
    best_val_hr = -1.0
    history = []

    warmstart_info = warmstart_from_oracle(agent, train_episodes, config)
    print(
        f"Warm-start complete | OracleSamples {warmstart_info['samples']} | "
        f"Loss {warmstart_info['loss']:.4f}"
    )

    initial_val_rl = eval_agent(agent, val_episodes, capacity=agent.capacity)
    initial_val_fifo = eval_fifo(val_episodes, capacity=agent.capacity)
    initial_val_lru = eval_lru(val_episodes, capacity=agent.capacity)
    print(
        f"After warm-start | ValRL {initial_val_rl:.4f} | "
        f"ValFIFO {initial_val_fifo:.4f} | ValLRU {initial_val_lru:.4f}"
    )

    if initial_val_rl > best_val_hr:
        best_val_hr = initial_val_rl
        agent.save(best_model_path, extra_metrics={"val_rl": best_val_hr})
        print("Saved best model:", best_model_path)

    for epoch in range(1, config["rl_epochs"] + 1):
        shuffled = train_episodes[:]
        random.shuffle(shuffled)
        epoch_losses = []
        train_hrs = []

        for accesses in shuffled:
            env = CacheEnv(agent.capacity)
            state = env.reset()

            for step_idx, addr in enumerate(accesses):
                done = step_idx == len(accesses) - 1
                action = agent.act(state, greedy=False)
                next_state, reward, _ = env.step(addr, action)
                agent.store(state, action, reward, next_state, done)
                loss = agent.train_step()
                if loss is not None:
                    epoch_losses.append(loss)
                state = next_state

            train_hrs.append(env.hits / max(env.hits + env.misses, 1))

        val_rl = eval_agent(agent, val_episodes, capacity=agent.capacity)
        val_fifo = eval_fifo(val_episodes, capacity=agent.capacity)
        val_lru = eval_lru(val_episodes, capacity=agent.capacity)
        avg_train_hr = float(np.mean(train_hrs)) if train_hrs else 0.0
        avg_loss = float(np.mean(epoch_losses)) if epoch_losses else 0.0

        history.append(
            {
                "epoch": epoch,
                "train_hr": avg_train_hr,
                "val_rl": val_rl,
                "val_fifo": val_fifo,
                "val_lru": val_lru,
                "loss": avg_loss,
                "epsilon": agent.eps,
            }
        )

        print(
            f"Epoch {epoch:02d}/{config['rl_epochs']} | "
            f"TrainRL {avg_train_hr:.4f} | ValRL {val_rl:.4f} | "
            f"ValFIFO {val_fifo:.4f} | ValLRU {val_lru:.4f} | "
            f"Loss {avg_loss:.4f} | Eps {agent.eps:.4f}"
        )

        if val_rl > best_val_hr:
            best_val_hr = val_rl
            agent.save(best_model_path, extra_metrics={"val_rl": best_val_hr})
            print("Saved best model:", best_model_path)

    return best_val_hr, history, warmstart_info


def main():
    print("Using device:", DEVICE)
    prepare_run_directories(CONFIG)
    ensure_dirs(CONFIG)

    capacity = CONFIG["capacity"]
    model_dir = Path(CONFIG["model_dir"])
    best_model_path = model_dir / "dqn_colab.pt"
    final_model_path = model_dir / "dqn_colab_final.pt"
    report_path = Path(CONFIG["report_path"])
    report_path.parent.mkdir(parents=True, exist_ok=True)

    train_data, val_data, test_data, trace_meta = build_datasets(CONFIG)

    print("Workload source: official_champsim_dpc3")
    print("Train episodes:", len(train_data))
    print("Val episodes:", len(val_data))
    print("Test episodes:", len(test_data))
    print("Episode length:", CONFIG["episode_len"])

    agent = Agent(CONFIG)
    print("Training...")
    best_val_hr, history, warmstart_info = train_agent(
        agent=agent,
        train_episodes=train_data,
        val_episodes=val_data,
        config=CONFIG,
        best_model_path=best_model_path,
    )

    agent.save(final_model_path, extra_metrics={"best_val_rl": best_val_hr})

    best_agent = Agent(CONFIG)
    best_agent.load(best_model_path)

    rl_test_hr = eval_agent(best_agent, test_data, capacity=capacity)
    fifo_test_hr = eval_fifo(test_data, capacity=capacity)
    lru_test_hr = eval_lru(test_data, capacity=capacity)

    report = {
        "workload_source": "official_champsim_dpc3",
        "trace_splits": TRACE_SPLITS,
        "trace_meta": trace_meta,
        "capacity": capacity,
        "episode_len": CONFIG["episode_len"],
        "skip_instructions": CONFIG["skip_instructions"],
        "max_instructions_per_trace": CONFIG["max_instructions_per_trace"],
        "warmstart": warmstart_info,
        "best_val_rl": best_val_hr,
        "test_metrics": {
            "rl": rl_test_hr,
            "fifo": fifo_test_hr,
            "lru": lru_test_hr,
        },
        "history": history,
        "best_model_path": str(best_model_path),
        "final_model_path": str(final_model_path),
    }

    with open(report_path, "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2)

    print("\n=== Final Test Results (Best Checkpoint) ===")
    print(f"RL     HitRate: {rl_test_hr:.4f}")
    print(f"FIFO   HitRate: {fifo_test_hr:.4f}")
    print(f"LRU    HitRate: {lru_test_hr:.4f}")
    print("Best model path:", best_model_path)
    print("Final model path:", final_model_path)
    print("Report path:", report_path)


if __name__ == "__main__":
    main()
