# Dulce Gestión

MVP web responsive para calcular costos, registrar compras, crear recetas y guardar ventas de una pastelería por encargo.

## Ejecutar localmente

Requiere Node.js 20 o posterior.

```bash
npm run serve
```

Abrir `http://localhost:4173`. Las pruebas se ejecutan con `npm test`.

## Publicación en GitHub Pages

La aplicación no necesita compilación: se puede publicar la raíz del repositorio desde **Settings → Pages → Deploy from a branch**. La interfaz es estática; los datos de la cuenta se guardan en Supabase y pueden exportarse como JSON. En GitHub Free, Pages requiere un repositorio público: no subir secretos, archivos `.env` ni respaldos. `cloud-config.js` contiene únicamente la clave pública prevista para el navegador; la protección de los datos depende de la autenticación y las políticas RLS de Supabase.

## Alcance de esta primera versión

- Insumos en gramos, kilogramos, mililitros o unidades. Los insumos ya registrados pueden mostrarse en otra unidad compatible sin alterar sus recetas ni movimientos anteriores.
- Edición manual del costo desde Insumos, por gramo/kilogramo, mililitro/litro o unidad, sin registrar compras ni cambiar la existencia. Actualiza el valor del stock y las recetas; las ventas y producciones históricas conservan sus costos. Los cambios quedan guardados en el respaldo del insumo.
- Compras y costo promedio ponderado. Las compras pueden corregirse o eliminarse con ajuste de stock e historial; si el stock o su valor quedarían negativos, la corrección se rechaza.
- Ajustes manuales de stock con motivo e historial; aportes de insumos del hogar al registrar producciones sin stock suficiente.
- Productos, recetas, rendimiento y precio de venta.
- Cada ingrediente de una receta permite elegir una unidad compatible, por ejemplo 500 g de un insumo registrado en kg. La conversión se aplica al costo y al consumo de stock.
- Ganancia sobre costo: `(precio de venta - costo) / costo × 100`. Un costo de $100 y una venta de $120 representan 20%; si el costo es cero se muestra «Sin costo definido».
- Eliminación de recetas con confirmación: desaparecen de las opciones para nuevos registros, conservando ventas, producciones e informes históricos. Primero deben completarse o cancelarse sus pedidos pendientes.
- Edición segura de insumos, productos y recetas. Los insumos sin stock ni movimientos o referencias pueden eliminarse.
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
- Integración opcional con Supabase para login, sincronización y control del estado comercial.
- Conversión automática y única de un pedido entregado en una venta.
- Informe mensual y exportación de respaldo.
- Informe mensual filtrable por cliente; las ventas directas pueden registrar un cliente opcional, y las anteriores sin ese dato se muestran como «Sin cliente».
- PWA instalable. La cuenta y la sincronización requieren conexión a Internet.

## Conexión con Supabase

GitHub Pages no tiene autenticación ni base de datos. Esta app usa el proyecto Supabase `esjxcfdgseiayalrwhhg`; el esquema y la primera cuenta ya están configurados. La conexión está activada para la prueba de inicio de sesión. Los datos que se cargaron previamente en el navegador eran pruebas y **no se suben automáticamente**. El respaldo descargado se conserva por separado.
