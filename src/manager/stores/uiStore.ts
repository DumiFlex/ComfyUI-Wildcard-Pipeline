import { defineStore } from "pinia";
import { ref } from "vue";

type Theme = "dark" | "light";

export const useUiStore = defineStore("ui", () => {
  const theme = ref<Theme>("dark");
  const sidebarCollapsed = ref(false);

  function toggleTheme() {
    theme.value = theme.value === "dark" ? "light" : "dark";
    document.documentElement.classList.toggle("light-theme", theme.value === "light");
  }

  function toggleSidebar() {
    sidebarCollapsed.value = !sidebarCollapsed.value;
  }

  return { theme, sidebarCollapsed, toggleTheme, toggleSidebar };
});
