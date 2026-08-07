import type { Claim, KnownRouteState, OwnTeamState } from "@null-city/contracts";
import { TEAM_TYPE_INITIAL, type ScenarioTopology } from "../topology/registry";
import "./TopologyMap.css";

export interface TopologyMapProps {
  topology: ScenarioTopology;
  routes: readonly KnownRouteState[];
  teams: readonly OwnTeamState[];
  claims: readonly Claim[];
  selectedDistrict: string | null;
  onSelectDistrict: (district: string | null) => void;
}

/**
 * Renders a scenario's topology from its local structural module only.
 * District nodes carry no simulated attribute values — the only "known"
 * annotation is the count of claims the player has actually received about
 * that district. Route closures come exclusively from `KnownRouteState`
 * (player-visible truth), never from a truth store.
 */
export function TopologyMap({ topology, routes, teams, claims, selectedDistrict, onSelectDistrict }: TopologyMapProps) {
  const districts = topology.districts;
  const topologyRoutes = topology.routes;
  const closedRouteIds = new Set(routes.filter((route) => route.closed).map((route) => route.id));
  const claimCountByDistrict = new Map<string, number>();
  for (const claim of claims) {
    if (!claim.districtId) {
      continue;
    }
    claimCountByDistrict.set(claim.districtId, (claimCountByDistrict.get(claim.districtId) ?? 0) + 1);
  }
  const teamsByDistrict = new Map<string, OwnTeamState[]>();
  for (const team of teams) {
    const list = teamsByDistrict.get(team.location) ?? [];
    list.push(team);
    teamsByDistrict.set(team.location, list);
  }

  return (
    <div className="topology-map-wrap">
      <svg viewBox="0 0 100 100" className="topology-svg" role="img" aria-label={`${topology.name} district topology`}>
        <title>{topology.name} district topology</title>
        {topologyRoutes.map((route) => {
          const from = districts.find((d) => d.id === route.from)!;
          const to = districts.find((d) => d.id === route.to)!;
          const closed = closedRouteIds.has(route.id);
          return (
            <line
              key={route.id}
              x1={from.x}
              y1={from.y}
              x2={to.x}
              y2={to.y}
              className={closed ? "topology-route-closed" : "topology-route"}
              strokeDasharray={closed ? "3 2" : undefined}
            >
              <title>
                {route.id} — {closed ? "closed" : "open"}
              </title>
            </line>
          );
        })}

        {districts.map((district) => {
          const claimCount = claimCountByDistrict.get(district.id) ?? 0;
          const districtTeams = teamsByDistrict.get(district.id) ?? [];
          const selected = selectedDistrict === district.id;
          return (
            <g
              key={district.id}
              className="topology-district-group"
              tabIndex={0}
              role="button"
              aria-pressed={selected}
              aria-label={`${district.label} district, ${claimCount} known claim${claimCount === 1 ? "" : "s"}`}
              onClick={() => onSelectDistrict(selected ? null : district.id)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onSelectDistrict(selected ? null : district.id);
                }
              }}
            >
              <circle
                cx={district.x}
                cy={district.y}
                r={selected ? 6.5 : 5.5}
                className={selected ? "topology-node-selected" : "topology-node"}
              />
              {claimCount > 0 && (
                <circle cx={district.x + 4.2} cy={district.y - 4.2} r={2.4} className="topology-claim-badge" />
              )}
              {claimCount > 0 && (
                <text x={district.x + 4.2} y={district.y - 4.2} className="topology-claim-badge-text">
                  {claimCount > 9 ? "9+" : claimCount}
                </text>
              )}
              {districtTeams.map((team, index) => (
                <g key={team.teamId} transform={`translate(${district.x - 5 + index * 3.2}, ${district.y + 7})`}>
                  <circle r={1.9} className={`topology-team topology-team-${team.status}`}>
                    <title>
                      {team.teamId} ({team.type}) — {team.status}
                      {team.orderTarget ? ` → ${team.orderTarget}` : ""}
                    </title>
                  </circle>
                  <text y={0.7} className="topology-team-text">
                    {TEAM_TYPE_INITIAL[team.type] ?? "?"}
                  </text>
                </g>
              ))}
              <text x={district.x} y={district.y + 11.5} className="topology-label">
                {district.label}
              </text>
            </g>
          );
        })}
      </svg>
      <div className="topology-legend" aria-hidden="true">
        <span>
          <i className="topology-legend-dot topology-team-idle" /> idle
        </span>
        <span>
          <i className="topology-legend-dot topology-team-transit" /> transit
        </span>
        <span>
          <i className="topology-legend-dot topology-team-working" /> working
        </span>
        <span>
          <i className="topology-legend-line topology-legend-closed" /> closed route
        </span>
      </div>
    </div>
  );
}
