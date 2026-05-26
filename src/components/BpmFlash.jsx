export default function BpmFlash({ bpm, visible }) {
  return <div className={"bpm-flash" + (visible ? " bpm-flash-in" : "")}>{"♩"} {bpm} BPM</div>;
}
