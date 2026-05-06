import json
import sys
from pathlib import Path

import numpy as np
import torch
import torch.nn as nn


DEVICE = torch.device("cpu")


class StateBuilder:
    def __init__(self, capacity, tick_norm=4096.0, count_norm=32.0, req_mod=65536.0):
        self.capacity = capacity
        self.state_dim = 5 * capacity + 3
        self.tick_norm = float(tick_norm)
        self.count_norm = float(count_norm)
        self.req_mod = float(req_mod)

    def build(self, state):
        cap = self.capacity
        counts = np.array(state["accessCounts"][:cap], dtype=np.float32)
        recency = np.array(state["lastAccess"][:cap], dtype=np.float32)
        lines = np.array(state["cacheLines"][:cap], dtype=np.float32)
        requested_raw = np.float32(state["requested"])

        occ_mask = (lines != 0).astype(np.float32)
        line_id_norm = (((lines % self.req_mod) / self.req_mod) * occ_mask).astype(np.float32)
        request_delta = np.clip((requested_raw - lines) / self.req_mod, -1.0, 1.0).astype(np.float32) * occ_mask
        norm_counts = np.clip(counts / self.count_norm, 0.0, 1.0)
        norm_recency = np.clip(recency / self.tick_norm, 0.0, 1.0)

        requested = (requested_raw % self.req_mod) / self.req_mod
        occupancy = np.float32(state["occupancy"])
        tick = np.clip(np.float32(state["currentTick"]) / self.tick_norm, 0.0, 1.0)

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


def main():
    payload = json.loads(sys.stdin.read() or "{}")

    model_path = Path(payload.get("modelPath", ""))
    capacity = int(payload.get("capacity", 16))
    state = payload.get("state", {})

    if not model_path.exists():
        print(json.dumps({"action": 0}))
        return

    builder = StateBuilder(capacity)
    model = DQN(builder.state_dim, capacity).to(DEVICE)

    try:
        checkpoint = torch.load(model_path, map_location=DEVICE)
        model.load_state_dict(checkpoint["policy_net"])
        model.eval()
    except Exception:
        print(json.dumps({"action": 0}))
        return

    state_vector = torch.tensor(builder.build(state), dtype=torch.float32, device=DEVICE).unsqueeze(0)
    cache_lines = np.array(state.get("cacheLines", [0] * capacity), dtype=np.int64)
    valid = np.where(cache_lines != 0)[0]

    if len(valid) == 0:
        print(json.dumps({"action": 0}))
        return

    with torch.no_grad():
        q_values = model(state_vector).squeeze(0).cpu().numpy()

    masked = np.full(capacity, -np.inf, dtype=np.float32)
    masked[valid] = q_values[valid]
    print(json.dumps({"action": int(np.argmax(masked))}))


if __name__ == "__main__":
    main()
