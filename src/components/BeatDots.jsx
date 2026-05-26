export default function BeatDots({ beat, active }) {
  return (
    <div className="beat-dots">
      {[0,1,2,3].map(i => (
        <div key={i} className={"beat-dot" + (active && beat === i ? (i===0?" dot-dn":" dot-up") : "")}/>
      ))}
    </div>
  );
}
