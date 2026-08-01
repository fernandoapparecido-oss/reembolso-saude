// A versão é carimbada no deploy (GitHub Actions) substituindo __BUILD__ pelo
// hash curto do commit. Em desenvolvimento local, fica como "dev".
export const BUILD = '__BUILD__';
export const buildLabel = () => (BUILD === '__BUILD__' ? 'dev' : BUILD);
