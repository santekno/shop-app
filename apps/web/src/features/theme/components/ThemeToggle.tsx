import { Moon } from "lucide-react";
import { Button } from "@/components/ui/Button.tsx";
import { useTheme } from "../useTheme.ts";

/**
 * The header's dark-mode switch: a toggle button. aria-pressed tells a
 * screen reader whether "Mode gelap" is on, so the name stays the same in
 * both states (a name that flips between "dark" and "light" leaves the
 * listener guessing whether it names the state or the action).
 */
export function ThemeToggle() {
  const { isDark, toggle } = useTheme();
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label="Mode gelap"
      aria-pressed={isDark}
      onClick={toggle}
      // Pressed: the moon is filled, so the state shows without colour.
      className="aria-pressed:bg-accent aria-pressed:[&_svg]:fill-current"
    >
      <Moon aria-hidden="true" />
    </Button>
  );
}
