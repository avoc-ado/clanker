import blessed from "blessed";

const GLITCH_CHARS = ["#", "░", "▒", "▓", "*", "/", "\\", "-"];

export const applyGlitchHeader = ({
  screen,
  box,
  text,
}: {
  screen: blessed.Widgets.Screen;
  box: blessed.Widgets.BoxElement;
  text: string;
}): (() => void) => {
  let tick = 0;
  const timer = setInterval(() => {
    const chars = text.split("");
    const out = chars.map((char, idx) => {
      if ((idx + tick) % 11 === 0) {
        return GLITCH_CHARS[(idx + tick) % GLITCH_CHARS.length] ?? char;
      }
      return char;
    });
    box.setContent(` ${out.join("")} `);
    screen.render();
    tick += 1;
  }, 400);

  return () => clearInterval(timer);
};
