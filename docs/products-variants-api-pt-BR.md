# Produtos: variantes (cor / tamanho) — API

Variantes ficam na coleção **`productvariants`** (`productId` + campos do schema). O admin pode enviar **`variants`** em **`POST /products`** e **`PATCH /products/:id`**; a lista substitui o conjunto atual (ids mantidos são atualizados; sem `_id` cria; removidos da lista são apagados).

## Corpo (Create / Update)

- Campos do produto: `name`, `slug`, `description`, `category`, `active`.
- Opcional **denormalizado** (sem `variants`): `sku`, `price`, `quantityInStock` — cria **uma** variante implícita.
- **`variants`**: se presente, **não pode ser `[]`** (422). Cada item:
  - `sku` (obrigatório, trim), `color`, `size`, `price` (≥ 0), `quantityInStock` e/ou `quantityOnHand` (≥ 0; guardamos em `quantityOnHand` e devolvemos os dois iguais na leitura), `_id` opcional (MongoId de variante já existente deste produto), `compareAtPrice`, `barcode`, `images`.

## Respostas

- **`GET /products`** e **`GET /products/:id`**: cada produto inclui **`variants`** com `quantityInStock` espelhando `quantityOnHand`.
- **`GET /public/catalog/products`**: cada variante inclui `quantityOnHand` e **`quantityInStock`** (mesmo valor).

## Erros

- **422** (`UnprocessableEntityException`): `variants` vazio, SKU duplicado no payload, preço/estoque inválidos.
- **409** (`ConflictException`): SKU já usado por outra variante (índice único / verificação prévia).

## Compatibilidade

- Produto sem variantes: permitido (legado).
- **`POST /products/:productId/variants`** continua disponível para criar variante isolada.
