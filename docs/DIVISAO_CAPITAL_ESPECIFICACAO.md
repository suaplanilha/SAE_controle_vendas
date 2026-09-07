# Especificação para homologação — Divisão do Capital

> **Estado:** homologado e implementado em 06/09/2026.

## 1. Entendimento do objetivo

A feature transforma cada **repasse semanal** em uma distribuição de capital
orientada por percentuais configuráveis. O usuário informa data e valor recebido;
o SAE calcula as destinações, apresenta os resultados antes da confirmação e
persiste um retrato imutável das regras utilizadas naquele lançamento.

A navegação passará a prever:

1. Dashboard;
2. Operações;
3. Divisão do capital;
4. Configurações;
5. Custos — item visível, sem implementação funcional até novas orientações.

A nova planilha de destino informada é
`1nhN1q2NEkwJ5YZVuUMQVAofMEgBGixKKDEQORwHuAuc`. O ID foi aplicado ao backend. O setup idempotente valida/cria as entidades do
módulo sem sobrescrever linhas existentes; a aba `Leo_bd` continua validada pelo
módulo de vendas.

## 2. Regra financeira homologada

As variáveis operacionais padrão serão:

- CMV;
- custo fixo;
- custo variável;
- capital de giro;
- crescimento.

Cada variável operacional usa:

```text
valor_variavel = repasse_semanal × (percentual_variavel / 100)
total_despesas = soma(valor_variavel operacional)
resultado_antes_reserva = repasse_semanal - total_despesas
reserva = resultado_antes_reserva × (percentual_reserva / 100)
pro_labore = resultado_antes_reserva - reserva
```

Esta fórmula está homologada. O valor `repasse - total_despesas` recebe o nome
**Lucro líquido**, e o Pró-Labore é o Lucro líquido após a retirada da Reserva.

### 2.1 Exemplo apenas para validar a fórmula

Para repasse de R$ 10.000,00, despesas operacionais totais de 70% e reserva de
10% sobre o resultado:

```text
total_despesas        = R$ 7.000,00
resultado_antes_reserva = R$ 3.000,00
reserva               = R$   300,00
pro_labore             = R$ 2.700,00
```

O exemplo não define percentuais do produto; serve somente para homologar a ordem
dos cálculos.

## 3. Por que uma tabela larga não atende às variáveis dinâmicas

O cabeçalho proposto (`CMV`, `c_fixo`, `c_variavel`, `capital_Giro`, etc.) funciona
somente enquanto as categorias forem fixas. Se o usuário puder criar variáveis,
cada nova categoria exigiria criar coluna, alterar código, migrar cabeçalhos e
redesenhar a tabela.

Para preservar a regra **uma aba = uma entidade** e permitir categorias dinâmicas,
a recomendação é armazenar o lançamento principal e seus itens em entidades
separadas. Na tela, o SAE monta uma tabela dinâmica semelhante à solicitada, sem
forçar o banco a possuir um número variável de colunas.

## 4. Modelo de dados recomendado

### 4.1 Aba `Capital_Config`

Uma linha por variável configurável:

| Coluna | Tipo | Regra |
| --- | --- | --- |
| `UUID` | UUID | Gerado no servidor |
| `nome` | string | Nome exibido, obrigatório |
| `slug` | string | Identificador técnico único e imutável |
| `percentual` | número | Percentual normalizado, entre 0 e 100 |
| `tipo` | enum | `DESPESA` ou `RESERVA` |
| `ordem` | inteiro | Ordenação no modal e na tabela |
| `ativo` | boolean | Inativa sem apagar histórico |
| `atualizado_em` | datetime ISO | Auditoria |

Regras iniciais:

- haverá no máximo uma variável ativa do tipo `RESERVA`;
- CMV, custo fixo, custo variável, capital de giro e crescimento serão seeds
  editáveis, não valores hard-coded no cálculo;
- nomes não poderão se repetir entre variáveis ativas;
- exclusão de configuração já utilizada será convertida em inativação;
- percentuais serão gravados como números, não como texto formatado.

### 4.2 Aba `Capital_Repasses`

Uma linha por repasse:

| Coluna | Tipo | Regra |
| --- | --- | --- |
| `UUID` | UUID | Identificador do lançamento |
| `data` | data ISO | Data do repasse |
| `repasse_semanal` | moeda numérica | Valor recebido |
| `total_despesas` | moeda numérica | Snapshot calculado |
| `lucro_liquido` | moeda numérica | Repasse menos despesas |
| `reserva` | moeda numérica | Snapshot calculado |
| `pro_labore` | moeda numérica | Resultado disponível ao proprietário |
| `config_versao` | string | Identifica o conjunto de regras aplicado |
| `criado_em` | datetime ISO | Auditoria |
| `atualizado_em` | datetime ISO | Auditoria |

### 4.3 Aba `Capital_Repasse_Itens`

Uma linha por variável aplicada a um repasse:

| Coluna | Tipo | Regra |
| --- | --- | --- |
| `UUID` | UUID | Identificador do item |
| `repasse_UUID` | UUID | Relação com `Capital_Repasses` |
| `variavel_UUID` | UUID | Relação com `Capital_Config` |
| `nome_snapshot` | string | Nome no momento do lançamento |
| `tipo_snapshot` | enum | `DESPESA` ou `RESERVA` |
| `percentual_snapshot` | número | Percentual utilizado |
| `base_calculo` | moeda numérica | Repasse ou resultado antes da reserva |
| `valor_calculado` | moeda numérica | Resultado da variável |
| `ordem_snapshot` | inteiro | Ordenação histórica |

Os campos snapshot garantem que alterações futuras em Configurações não mudem
silenciosamente repasses já consolidados.

## 5. Página Configurações

A página terá:

- lista ordenável de variáveis;
- nome, percentual, tipo e status;
- criação de nova variável;
- edição de percentual;
- ativação/inativação;
- soma visível dos percentuais de despesas;
- aviso ou bloqueio quando a soma exceder o limite homologado;
- confirmação antes de afetar os próximos lançamentos.

O backend continuará sendo a autoridade: validará nomes, percentuais, tipo,
unicidade, limite total e concorrência com `LockService`.

## 6. Página Divisão do capital

### 6.1 Mini KPIs

- Pró-Labore acumulado no mês;
- Pró-Labore acumulado no ano;
- despesas acumuladas no mês;
- despesas acumuladas no ano;
- variação percentual contra o período imediatamente anterior equivalente.

Proposta para os elementos com bordas compartilhadas:

- mês atual contra mês anterior;
- ano atual contra ano anterior até a mesma data;
- `Aumentou 12%`, `Reduziu 4,05%`, `Sem alteração` ou `Sem base`;
- nunca apresentar infinito quando o período anterior for zero.

### 6.2 Tabela

A tabela apresentará:

- UUID (poderá ficar disponível em detalhe/copiar, sem poluir a visão mobile);
- data;
- repasse semanal;
- uma coluna dinâmica para cada variável de despesa ativa ou historicamente usada;
- total de despesas;
- reserva;
- resultado antes da reserva ou lucro líquido, conforme nomenclatura homologada;
- Pró-Labore;
- editar/excluir.

Em celular, a mesma informação deverá usar cards expansíveis ou tabela com
priorização de colunas, evitando uma grade horizontal impossível de ler.

## 7. Modal de repasse

Fluxo proposto:

1. abrir com a data atual no timezone `America/Sao_Paulo`;
2. carregar a configuração ativa do servidor;
3. informar o repasse;
4. ao digitar ou sair do campo, recalcular todas as variáveis localmente para
   resposta imediata;
5. exibir em cada variável um flat pill com o percentual ativo;
6. mostrar total de despesas, resultado antes da reserva, reserva e Pró-Labore;
7. enviar repasse, versão/configuração e resultados ao backend;
8. o backend relerá a configuração, recalculará tudo e recusará valores adulterados
   ou configuração desatualizada;
9. persistir repasse e itens sob o mesmo bloqueio lógico;
10. atualizar tabela e KPIs sem recarregar a página.

Botões:

- **Cancelar** — fecha sem persistir;
- **Salvar novo** — persiste, limpa o valor e mantém o modal aberto;
- **Salvar repasse** — persiste e fecha.

### 7.1 Edição rápida dentro do modal

A edição rápida altera somente os percentuais do lançamento aberto. O override é
gravado no snapshot dos itens e não modifica `Capital_Config`. Alterações globais
são realizadas exclusivamente na página Configurações.

## 8. Backend GAS implementado

Funções públicas para `google.script.run`:

- `getCapitalBootstrap(filters)`;
- `listCapitalTransfers(query)`;
- `createCapitalTransfer(input)`;
- `updateCapitalTransfer(input)`;
- `deleteCapitalTransfer(uuid)`;
- `listCapitalVariables()`;
- `createCapitalVariable(input)`;
- `updateCapitalVariable(input)`;
- `setCapitalVariableStatus(input)`.

Funções internas separarão repositório, validação, cálculo, snapshot e agregações.
Todas as mutações usarão `LockService`; ranges serão lidos/escritos em lote.

Como Google Sheets não oferece transação entre abas, a criação deverá validar
tudo antes da primeira escrita, gravar repasse e itens em sequência sob lock e
registrar estado suficiente para detectar/recuperar uma gravação parcial.

## 9. Critérios de aceite propostos

- Alterar configuração afeta novos repasses, sem recalcular históricos.
- Uma variável criada aparece no modal sem alteração de código.
- O cálculo visto no navegador coincide centavo a centavo com o backend.
- Valores persistidos preservam a precisão do cálculo e são exibidos com duas casas decimais.
- “Salvar novo” não duplica o envio anterior.
- KPIs conciliam com a soma manual da tabela.
- Variação sem base apresenta `Sem base`, nunca `Infinity` ou `NaN`.
- Editar um repasse preserva ou atualiza snapshots conforme regra homologada.
- Inativar variável não apaga itens históricos.
- Falha parcial entre abas é detectável e recuperável.
- A página Custos aparece como “Em breve” e não executa ações.
- Dashboard e Operações continuam funcionando na nova planilha.

## 10. Decisões homologadas

- Reserva calculada sobre o Lucro líquido; Pró-Labore é Lucro líquido menos Reserva.
- Despesas podem ultrapassar 100%, com alerta e sem bloqueio.
- Cálculos preservam precisão; a interface e o Sheets exibem duas casas decimais.
- Edição rápida é exceção do lançamento; mudanças globais ficam em Configurações.
- Histórico nunca é recalculado automaticamente e sua edição parte do snapshot.
- Exclusão de repasses é lógica.
- Novas despesas usam sempre o repasse como base; existe uma única Reserva.
- Variações usam mês anterior e mesmo período do ano anterior.
- O acesso às operações permanece público.
- As três abas propostas estão aprovadas e são garantidas pelo setup.
- Custos permanece como página “Em breve”, sem entidade Sheets.

## 11. Implementação entregue

- Setup idempotente das entidades e seeds de configuração.
- CRUD de variáveis, repasses, snapshots e exclusão lógica.
- Cálculo revalidado no servidor e overrides locais por lançamento.
- Página Divisão do capital, Configurações e placeholder Custos no Vue.
- KPIs, variações, tabela dinâmica e modal responsivo.
