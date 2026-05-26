export default function SwaraCard({ swara, state, pitchMatched }) {
  const oct = swara.octave ?? 1;
  return (
    <div className={"swara-card card-" + state + (pitchMatched ? " card-match" : "")}>
      <span className="card-dv">{swara.dv}</span>
      <span className={"card-name" + (oct === 0 ? " oct-mandra" : "")}>
        {swara.short}{oct === 2 && <span className="oct-dot-above">·</span>}
      </span>
    </div>
  );
}
