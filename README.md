# Dulce Gestión

MVP web responsive para calcular costos, registrar compras, crear recetas y guardar ventas de una pastelería por encargo.

## Ejecutar localmente

Requiere Node.js 20 o posterior.

```bash
npm run serve
```

Abrir `http://localhost:4173`. Las pruebas se ejecutan con `npm test`.

## Publicación en Cloudflare Pages

El repositorio de GitHub conserva el código fuente. La página de producción se aloja en Cloudflare Pages mediante Direct Upload: https://dulce-gestion-c70.pages.dev/. Los cambios en GitHub no se despliegan en Cloudflare hasta que el propietario lo solicite expresamente.

La aplicación es estática y no necesita compilación. Al preparar la próxima publicación, incluir los archivos de la raíz de la aplicación y la carpeta `vendor/` completa, con `index.html` en la raíz del archivo ZIP. El generador de PDF necesita `pdf-export.js`, `vendor/jspdf.umd.min.js` y `vendor/jspdf.plugin.autotable.min.js`; conservar también sus licencias. No incluir `test/`, respaldos, archivos `.env`, `.git` ni datos del negocio.

Los datos de la cuenta se guardan en Supabase. `cloud-config.js` contiene únicamente la clave pública prevista para el navegador; la protección de los datos depende de la autenticación y las políticas RLS de Supabase.

## Exportar datos

En **Datos y respaldos** se puede descargar un respaldo JSON para restaurar la aplicación o un **informe completo en PDF** para consultar, imprimir o archivar.

El PDF incluye resumen, clientes y contactos, existencias, costos manuales, productos, recetas y gastos, combos, compras y correcciones, ajustes de stock, pedidos y saldos calculados, ventas y resumen mensual, producciones y sus desgloses históricos. Identifica los registros anulados o eliminados que se conservan, los costos actuales frente a los históricos y los borradores pendientes de sincronización. Los saldos se calculan restando las señas: la aplicación no registra cobros posteriores. La ganancia bruta no equivale a ganancia neta.

La generación y descarga se hacen localmente en el navegador. Las bibliotecas están incluidas en `vendor/` con versiones fijas y licencias MIT; no se usan servicios externos de conversión ni una nueva API. La caché de la PWA incluye estos archivos para poder exportar los datos ya cargados sin conexión. El PDF no permite restaurar la aplicación: conservar el JSON para ese fin.

En **Informes** también se descargan reportes PDF individuales de **ventas**, **compras de insumos** o **clientes registrados**, con un mes específico, un rango de fechas (inicio y fin incluidos) o todos los períodos. Cada PDF identifica el período y contiene su resumen y detalle. Los reportes individuales excluyen registros anulados y eliminados; las ventas conservan sus costos históricos. Sus filtros son independientes de la consulta mensual en pantalla.

Los clientes nuevos guardan su fecha de registro. Los anteriores sin fecha se incluyen al elegir **Todos los períodos**, identificados como «Sin fecha registrada»; no se inventa una fecha al editarlos. Al filtrar clientes por fechas, el PDF informa cuántos registros sin fecha quedaron fuera. Las fechas de registro se interpretan en horario de Uruguay.

## Alcance de esta primera versión

- Insumos en gramos, kilogramos, mililitros o unidades. Los insumos ya registrados pueden mostrarse en otra unidad compatible sin alterar sus recetas ni movimientos anteriores.
- Edición manual del costo desde Insumos, por gramo/kilogramo, mililitro/litro o unidad, sin registrar compras ni cambiar la existencia. Actualiza el valor del stock y las recetas; las ventas y producciones históricas conservan sus costos. Los cambios quedan guardados en el respaldo del insumo.
- Compras y costo promedio ponderado. Las compras pueden corregirse o eliminarse con ajuste de stock e historial; si el stock o su valor quedarían negativos, la corrección se rechaza.
- Ajustes manuales de stock con motivo e historial; aportes de insumos del hogar al registrar producciones sin stock suficiente.
- Productos, recetas, rendimiento y precio de venta.
- Combos en un apartado propio: packs con cantidades de productos, empaque adicional, costo actualizado según recetas e insumos, precio de venta y ganancia. Permiten copiar una descripción con su precio para redes, sin incluir costos internos.
- Los combos se pueden elegir en pedidos, ventas y producción. Sus costos históricos quedan conservados al registrar ventas y producciones; sus ingredientes compartidos se suman antes de descontar stock.
- Los productos incluidos en combos activos no pueden eliminarse hasta quitarlos del pack. Los combos pueden editarse o eliminarse conservando el historial; los pedidos pendientes deben completarse o cancelarse antes de eliminarlos.
- Cada ingrediente de una receta permite elegir una unidad compatible, por ejemplo 500 g de un insumo registrado en kg. La conversión se aplica al costo y al consumo de stock.
- Ganancia sobre costo: `(precio de venta - costo) / costo × 100`. Un costo de $100 y una venta de $120 representan 20%; si el costo es cero se muestra «Sin costo definido».
- Eliminación de recetas con confirmación: desaparecen de las opciones para nuevos registros, conservando ventas, producciones e informes históricos. Primero deben completarse o cancelarse sus pedidos pendientes.
- Eliminación de cualquier insumo con confirmación, aunque tenga stock, costos, compras, ajustes o recetas. Desaparece del inventario activo y de las opciones para nuevas compras y recetas; se conserva con fecha y autor de eliminación para mantener referencias y costos históricos. Su stock queda fuera de la valoración activa. Las recetas existentes conservan el último costo y deben reemplazar o quitar ese insumo antes de volver a producir; los combos que las incluyen también quedan fuera de nuevas producciones. Se mantienen las correcciones de compras y reversiones de producciones históricas.
- Registro de producciones por tanda con validación y descuento de materias primas.
- Gastos opcionales: envases, mano de obra, gas, electricidad, reparto y otros.
- Ventas con una fotografía del costo al momento de registrarlas.
- Pedidos con cliente, teléfono opcional, fecha de entrega, seña, saldo, notas y estado. Se muestran del más reciente al más antiguo; al eliminarlos salen de la vista y la agenda, pero sus ventas vinculadas permanecen.
- Filtros de pedidos por cliente y estado, con un máximo de 8 pedidos por página.
- Fichero de clientes reutilizable, con opción de eliminación sin borrar los pedidos registrados, y agenda de entregas agrupada por fecha.
- Producciones mostradas del registro más reciente al más antiguo.
- Anulación auditable de producciones con devolución exacta de insumos.
- Eliminación de producciones: desaparecen de la lista, revierten el stock si estaban activas y permanecen en el respaldo para auditoría. Cada producción muestra un desglose de sus costos históricos; las nuevas también guardan el detalle de gastos adicionales.
- Respaldos versionados, restauración validada y compatibilidad con exportaciones anteriores.
- Los nuevos respaldos usan versión 3 para conservar combos y siguen aceptando respaldos de las versiones 1 y 2.
- Integración opcional con Supabase para login, sincronización y control del estado comercial.
- Conversión automática y única de un pedido entregado en una venta.
- Informe mensual y exportación de respaldo.
- Informe mensual filtrable por cliente; las ventas directas pueden registrar un cliente opcional, y las anteriores sin ese dato se muestran como «Sin cliente».
- PWA instalable. La cuenta y la sincronización requieren conexión a Internet.

## Conexión con Supabase

GitHub Pages no tiene autenticación ni base de datos. Esta app usa el proyecto Supabase `esjxcfdgseiayalrwhhg`; el esquema y la primera cuenta ya están configurados. La conexión está activada para la prueba de inicio de sesión. Los datos que se cargaron previamente en el navegador eran pruebas y **no se suben automáticamente**. El respaldo descargado se conserva por separado.
