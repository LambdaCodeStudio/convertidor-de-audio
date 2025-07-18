// theme-utils.js
// Utilidades para manejar el tema global en toda la aplicación

/**
 * Obtiene la preferencia de tema actual
 * @returns {boolean} true si es modo oscuro, false si es modo claro
 */
export function getCurrentTheme() {
  if (typeof window === 'undefined') return false;
  
  const saved = localStorage.getItem('theme-preference');
  const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  
  return saved === 'dark' || (saved === null && prefersDark);
}

/**
 * Aplica el tema al documento
 * @param {boolean} isDark - true para modo oscuro, false para modo claro
 */
export function applyTheme(isDark) {
  if (typeof window === 'undefined') return;
  
  if (isDark) {
    document.documentElement.classList.add('dark');
    document.body.style.backgroundColor = '#111827';
    document.body.style.color = '#f9fafb';
  } else {
    document.documentElement.classList.remove('dark');
    document.body.style.backgroundColor = '#ffffff';
    document.body.style.color = '#111827';
  }
}

/**
 * Cambia el tema y lo persiste
 * @param {boolean} isDark - true para modo oscuro, false para modo claro
 */
export function setTheme(isDark) {
  if (typeof window === 'undefined') return;
  
  // Guardar en localStorage
  localStorage.setItem('theme-preference', isDark ? 'dark' : 'light');
  
  // Aplicar el tema
  applyTheme(isDark);
  
  // Disparar evento para sincronizar con otros componentes
  window.dispatchEvent(new CustomEvent('theme-change', {
    detail: { isDark }
  }));
}

/**
 * Alterna entre modo claro y oscuro
 */
export function toggleTheme() {
  const current = getCurrentTheme();
  setTheme(!current);
}

/**
 * Configura un listener para cambios de tema
 * @param {function} callback - Función que se ejecuta cuando cambia el tema
 * @returns {function} Función para limpiar el listener
 */
export function onThemeChange(callback) {
  if (typeof window === 'undefined') return () => {};
  
  const handleStorageChange = (e) => {
    if (e.key === 'theme-preference') {
      callback(e.newValue === 'dark');
    }
  };
  
  const handleCustomEvent = (e) => {
    callback(e.detail.isDark);
  };
  
  window.addEventListener('storage', handleStorageChange);
  window.addEventListener('theme-change', handleCustomEvent);
  
  // Función de limpieza
  return () => {
    window.removeEventListener('storage', handleStorageChange);
    window.removeEventListener('theme-change', handleCustomEvent);
  };
}

/**
 * Inicializa el tema al cargar la página
 */
export function initializeTheme() {
  if (typeof window === 'undefined') return;
  
  const isDark = getCurrentTheme();
  
  // Aplicar el tema inmediatamente para evitar flash
  applyTheme(isDark);
  
  // Guardar la preferencia inicial si no existe
  if (!localStorage.getItem('theme-preference')) {
    localStorage.setItem('theme-preference', isDark ? 'dark' : 'light');
  }
}

/**
 * Hook de React para usar el tema
 * @returns {[boolean, function]} [isDarkMode, setDarkMode]
 */
export function useTheme() {
  if (typeof window === 'undefined') return [false, () => {}];
  
  const [isDark, setIsDark] = React.useState(getCurrentTheme);
  
  React.useEffect(() => {
    // Inicializar el tema
    const currentTheme = getCurrentTheme();
    setIsDark(currentTheme);
    applyTheme(currentTheme);
    
    // Configurar listener para cambios
    const cleanup = onThemeChange((newIsDark) => {
      setIsDark(newIsDark);
    });
    
    return cleanup;
  }, []);
  
  const updateTheme = React.useCallback((newIsDark) => {
    setTheme(newIsDark);
    setIsDark(newIsDark);
  }, []);
  
  return [isDark, updateTheme];
}

/**
 * Clases CSS para usar con el tema actual
 */
export const themeClasses = {
  // Fondos
  bg: 'bg-white dark:bg-gray-900',
  bgSecondary: 'bg-gray-50 dark:bg-gray-800',
  bgTertiary: 'bg-gray-100 dark:bg-gray-700',
  
  // Textos
  text: 'text-gray-900 dark:text-white',
  textSecondary: 'text-gray-600 dark:text-gray-300',
  textMuted: 'text-gray-500 dark:text-gray-400',
  
  // Bordes
  border: 'border-gray-300 dark:border-gray-600',
  borderLight: 'border-gray-200 dark:border-gray-700',
  
  // Inputs
  input: 'bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600 text-gray-900 dark:text-white',
  
  // Buttons
  buttonPrimary: 'bg-blue-600 hover:bg-blue-700 dark:bg-blue-700 dark:hover:bg-blue-800 text-white',
  buttonSecondary: 'bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-900 dark:text-white',
  
  // Shadows
  shadow: 'shadow-lg dark:shadow-2xl',
  shadowMd: 'shadow-md dark:shadow-xl',
  
  // Hover effects
  hover: 'hover:bg-gray-50 dark:hover:bg-gray-800',
  hoverSecondary: 'hover:bg-gray-100 dark:hover:bg-gray-700'
};

/**
 * Función para obtener clases condicionales basadas en el tema
 * @param {string} lightClass - Clases para modo claro
 * @param {string} darkClass - Clases para modo oscuro
 * @returns {string} Clases CSS
 */
export function getThemeClasses(lightClass, darkClass = '') {
  if (typeof window === 'undefined') return lightClass;
  
  const isDark = getCurrentTheme();
  return isDark && darkClass ? darkClass : lightClass;
}

// Exportar todo como objeto por defecto también
export default {
  getCurrentTheme,
  applyTheme,
  setTheme,
  toggleTheme,
  onThemeChange,
  initializeTheme,
  useTheme,
  themeClasses,
  getThemeClasses
};