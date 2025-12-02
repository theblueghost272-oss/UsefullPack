import { world } from "@minecraft/server";

// ===== CONFIGURATION =====
const SETTINGS = {
  maxCluster: 128,         // Max blocks in one cluster
  clusterRadius: 8,        // Search distance
  leafRadius: 8,           // How far to clear leaves from logs
  leafLimit: 256           // Max leaves per chop
};

// ===== BLOCK GROUPS (A–Z Sorted) =====
const BLOCK_GROUPS = {
  ores: [
    "minecraft:ancient_debris",
    "minecraft:coal_ore",
    "minecraft:copper_ore",
    "minecraft:deepslate_coal_ore",
    "minecraft:deepslate_copper_ore",
    "minecraft:deepslate_diamond_ore",
    "minecraft:deepslate_emerald_ore",
    "minecraft:deepslate_gold_ore",
    "minecraft:deepslate_iron_ore",
    "minecraft:deepslate_lapis_ore",
    "minecraft:deepslate_redstone_ore",
    "minecraft:diamond_ore",
    "minecraft:emerald_ore",
    "minecraft:gold_ore",
    "minecraft:iron_ore",
    "minecraft:lapis_ore",
    "minecraft:lit_deepslate_redstone_ore",
    "minecraft:lit_redstone_ore",
    "minecraft:nether_gold_ore",
    "minecraft:nether_quartz_ore",
    "minecraft:redstone_ore"
  ],
  logs: [
    "minecraft:acacia_log",
    "minecraft:birch_log",
    "minecraft:cherry_log",
    "minecraft:crimson_stem",
    "minecraft:dark_oak_log",
    "minecraft:jungle_log",
    "minecraft:mangrove_log",
    "minecraft:oak_log",
    "minecraft:spruce_log",
    "minecraft:stripped_acacia_log",
    "minecraft:stripped_birch_log",
    "minecraft:stripped_cherry_log",
    "minecraft:stripped_crimson_stem",
    "minecraft:stripped_dark_oak_log",
    "minecraft:stripped_jungle_log",
    "minecraft:stripped_mangrove_log",
    "minecraft:stripped_oak_log",
    "minecraft:stripped_spruce_log",
    "minecraft:stripped_warped_stem",
    "minecraft:warped_stem"
  ],
  leaves: [
    "minecraft:acacia_leaves",
    "minecraft:birch_leaves",
    "minecraft:cherry_leaves",
    "minecraft:crimson_hyphae",
    "minecraft:dark_oak_leaves",
    "minecraft:jungle_leaves",
    "minecraft:mangrove_leaves",
    "minecraft:oak_leaves",
    "minecraft:spruce_leaves",
    "minecraft:warped_hyphae"
  ],
  gravel: [
    "minecraft:gravel"
  ]
};

// ===== UTILITIES =====
const makeKey = (x, y, z) => `${x},${y},${z}`;
const sq = n => n * n;
const distanceSq = (a, b) =>
  sq(a.x - b.x) + sq(a.y - b.y) + sq(a.z - b.z);

const isOre = b => !!b?.type && BLOCK_GROUPS.ores.includes(b.type.id);
const isLog = b => !!b?.type && BLOCK_GROUPS.logs.includes(b.type.id);
const isLeaf = b => !!b?.type && BLOCK_GROUPS.leaves.includes(b.type.id);
const isGravel = b => !!b?.type && BLOCK_GROUPS.gravel.includes(b.type.id);

// ===== ENCHANT HELPERS =====
function getEnchantLevel(player, name) {
  try {
    const equip = player.getComponent("minecraft:equippable") || player.getComponent("minecraft:equipment_inventory");
    const tool = equip?.getEquipment?.("mainhand") || equip?.getMainhand?.();
    if (!tool) return 0;
    const ench = tool.getComponent("minecraft:enchantments")?.enchantments;
    if (!ench) return 0;
    const list = Array.isArray(ench) ? ench : [];
    for (const e of list) {
      const id = e?.type?.id || e?.id || "";
      if (id.toLowerCase().includes(name.toLowerCase())) {
        return e.level || 1;
      }
    }
  } catch { }
  return 0;
}

const hasSilkTouch = player => getEnchantLevel(player, "silk") > 0;
const getFortuneLevel = player => getEnchantLevel(player, "fortune");

// ===== CLUSTER SEARCH (DFS) =====
function findCluster(start, dimension, matchFn) {
  const origin = { ...start };
  const stack = [origin];
  const visited = new Set([makeKey(origin.x, origin.y, origin.z)]);
  const found = [];

  const dirs = [
    [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]
  ];

  while (stack.length && found.length < SETTINGS.maxCluster) {
    const cur = stack.pop();
    const blk = dimension.getBlock(cur);
    if (!matchFn(blk)) continue;
    found.push(cur);

    for (const [dx, dy, dz] of dirs) {
      const nx = cur.x + dx, ny = cur.y + dy, nz = cur.z + dz;
      if (distanceSq(origin, { x: nx, y: ny, z: nz }) > sq(SETTINGS.clusterRadius)) continue;
      const id = makeKey(nx, ny, nz);
      if (visited.has(id)) continue;
      visited.add(id);
      stack.push({ x: nx, y: ny, z: nz });
    }
  }
  return found;
}

// ===== MAIN HANDLER =====
world.beforeEvents.playerBreakBlock.subscribe(async ev => {
  const { block, player } = ev;
  if (!block || !player?.isSneaking) return;

  let type = null;
  if (isOre(block)) type = "ore";
  else if (isLog(block)) type = "log";
  else if (isGravel(block)) type = "gravel";
  if (!type) return;

  const dim = block.dimension ?? ev.dimension;
  const cluster = findCluster(block.location, dim,
    type === "ore" ? isOre : type === "log" ? isLog : isGravel
  );
  if (cluster.length < 2) return;

  const originID = makeKey(block.location.x, block.location.y, block.location.z);
  const silk = type === "ore" && hasSilkTouch(player);
  const fortune = type === "ore" ? getFortuneLevel(player) : getFortuneLevel(player);

  let broken = 0;
  for (const pos of cluster) {
    if (makeKey(pos.x, pos.y, pos.z) === originID) continue;
    if (broken >= SETTINGS.maxCluster) break;
    const cur = dim.getBlock(pos);
    if (!cur) continue;

    if (type === "ore") {
      if (!isOre(cur)) continue;
      if (silk) {
        try { await dim.runCommandAsync(`setblock ${pos.x} ${pos.y} ${pos.z} air replace`); } catch { }
        try { await player.runCommandAsync(`give @s ${cur.type.id} 1`); } catch { }
      } else {
        try { await dim.runCommandAsync(`setblock ${pos.x} ${pos.y} ${pos.z} air destroy`); } catch { }
        // simulate fortune
        if (fortune > 0) {
          const bonus = Math.floor(Math.random() * (fortune + 1));
          if (bonus > 0) {
            try { await player.runCommandAsync(`give @s ${cur.type.id.replace("_ore", "")} ${bonus}`); } catch { }
          }
        }
      }
    } else if (type === "log") {
      if (!isLog(cur)) continue;
      try { await dim.runCommandAsync(`setblock ${pos.x} ${pos.y} ${pos.z} air destroy`); } catch { }
    } else if (type === "gravel") {
      if (!isGravel(cur)) continue;
      try { await dim.runCommandAsync(`setblock ${pos.x} ${pos.y} ${pos.z} air destroy`); } catch { }
      // Fortune logic for gravel -> flint
      let drop = "minecraft:gravel";
      if (fortune > 0) {
        const chance = Math.min(0.1 + 0.1 * fortune, 1);
        if (Math.random() < chance) drop = "minecraft:flint";
      } else if (Math.random() < 0.1) {
        drop = "minecraft:flint";
      }
      try { await player.runCommandAsync(`give @s ${drop} 1`); } catch { }
    }
    broken++;
  }

  // Handle leaves if tree chopped
  if (type === "log") {
    let leavesCleared = 0;
    for (const log of cluster) {
      for (let dx = -SETTINGS.leafRadius; dx <= SETTINGS.leafRadius; dx++) {
        for (let dy = -SETTINGS.leafRadius; dy <= SETTINGS.leafRadius; dy++) {
          for (let dz = -SETTINGS.leafRadius; dz <= SETTINGS.leafRadius; dz++) {
            if (leavesCleared >= SETTINGS.leafLimit) return;
            const lx = log.x + dx, ly = log.y + dy, lz = log.z + dz;
            if (distanceSq(log, { x: lx, y: ly, z: lz }) > sq(SETTINGS.leafRadius)) continue;
            const leaf = dim.getBlock({ x: lx, y: ly, z: lz });
            if (!isLeaf(leaf)) continue;
            try { await dim.runCommandAsync(`setblock ${lx} ${ly} ${lz} air destroy`); } catch { }
            leavesCleared++;
          }
        }
      }
    }
  }

  // ===== XP BONUS SYSTEM =====
  if (cluster.length > 2) {
    const xp = Math.min(Math.floor(cluster.length / 4), 30);
    try {
      await dim.runCommandAsync(`xp add "${player.nameTag}" ${xp} points`);
      await dim.runCommandAsync(`particle minecraft:experience_orb ${block.location.x} ${block.location.y} ${block.location.z}`);
      await dim.runCommandAsync(`playsound random.orb @a[name="${player.nameTag}"] ${block.location.x} ${block.location.y} ${block.location.z}`);
    } catch { }
  }
});