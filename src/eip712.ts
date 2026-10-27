import {
  getNadoEIP712Domain,
  getNadoEIP712PrimaryType,
  getNadoEIP712Types,
  getNadoEIP712Values,
  getOrderDigest,
  getOrderNonce,
  getOrderVerifyingAddress,
  packOrderAppendix,
  subaccountToHex,
  type EIP712OrderParams,
} from "@nadohq/client";
import { type Hex, type TypedDataDomain } from "viem";
import { privateKeyToAccount } from "viem/accounts";

export interface TypedMessage {
  sender: Hex;
  [key: string]: string | number | readonly string[] | readonly number[] | Hex;
}

export interface BuiltPlace {
  kind: "place_order";
  primaryType: string;
  domain: TypedDataDomain;
  types: Record<string, { name: string; type: string }[]>;
  /** 提交给网关的字符串字段。签名前再转成 bigint。 */
  message: {
    sender: Hex;
    priceX18: string;
    amount: string;
    expiration: string;
    nonce: string;
    appendix: string;
  };
  digest: Hex;
  productId: number;
  orderParams: EIP712OrderParams;
  spotLeverage: boolean | null;
}

export interface BuiltCancel {
  kind: "cancel_orders";
  primaryType: string;
  domain: TypedDataDomain;
  types: Record<string, { name: string; type: string }[]>;
  message: {
    sender: Hex;
    productIds: number[];
    digests: Hex[];
    nonce: string;
  };
}

const POST_ONLY = () => packOrderAppendix({ orderExecutionType: "post_only" });

/**
 * 构造 post-only 限价单的 EIP-712。价格是人类可读小数，数量是带符号的 x18 整数。
 * 与 @nadohq/client 交给序列器的字段一致。
 */
export function buildPlace(input: {
  owner: Hex;
  subaccountName: string;
  productId: number;
  chainId: number;
  price: string;
  amountX18: bigint;
  expirationSec: bigint;
  nonce?: string;
  spot: boolean;
}): BuiltPlace {
  const orderParams: EIP712OrderParams = {
    subaccountOwner: input.owner,
    subaccountName: input.subaccountName,
    price: input.price,
    amount: input.amountX18.toString(),
    expiration: input.expirationSec.toString(),
    nonce: input.nonce ?? getOrderNonce(),
    appendix: POST_ONLY().toString(),
  };
  const raw = getNadoEIP712Values("place_order", orderParams);
  const message = {
    sender: asHex(raw.sender),
    priceX18: String(raw.priceX18),
    amount: String(raw.amount),
    expiration: String(raw.expiration),
    nonce: String(raw.nonce),
    appendix: String(raw.appendix),
  };
  const verifyingContract = getOrderVerifyingAddress(input.productId);
  return {
    kind: "place_order",
    primaryType: getNadoEIP712PrimaryType("place_order"),
    domain: getNadoEIP712Domain(verifyingContract, input.chainId),
    types: typed(getNadoEIP712Types("place_order")),
    message,
    digest: getOrderDigest({ order: orderParams, chainId: input.chainId, productId: input.productId }) as Hex,
    productId: input.productId,
    orderParams,
    spotLeverage: input.spot ? false : null,
  };
}

export function buildCancel(input: {
  owner: Hex;
  subaccountName: string;
  productId: number;
  chainId: number;
  endpoint: Hex;
  digests: readonly Hex[];
  nonce?: string;
}): BuiltCancel {
  const params = {
    subaccountOwner: input.owner,
    subaccountName: input.subaccountName,
    productIds: [input.productId],
    digests: [...input.digests],
    nonce: input.nonce ?? getOrderNonce(),
  };
  const raw = getNadoEIP712Values("cancel_orders", params);
  return {
    kind: "cancel_orders",
    primaryType: getNadoEIP712PrimaryType("cancel_orders"),
    domain: getNadoEIP712Domain(input.endpoint, input.chainId),
    types: typed(getNadoEIP712Types("cancel_orders")),
    message: {
      sender: asHex(raw.sender),
      productIds: [...raw.productIds],
      digests: raw.digests.map((item) => asHex(item)),
      nonce: String(raw.nonce),
    },
  };
}

export async function signBuilt(privateKey: Hex, built: BuiltPlace | BuiltCancel): Promise<Hex> {
  const account = privateKeyToAccount(privateKey);
  const message = signableMessage(built);
  return account.signTypedData({
    domain: built.domain,
    types: built.types,
    primaryType: built.primaryType,
    message,
  });
}

export function subaccountOf(owner: Hex, name: string): Hex {
  return subaccountToHex({ subaccountOwner: owner, subaccountName: name });
}

export function placeBody(built: BuiltPlace, signature: Hex): unknown {
  return {
    place_order: {
      product_id: built.productId,
      order: built.message,
      signature,
      spot_leverage: built.spotLeverage,
      id: null,
    },
  };
}

export function cancelBody(built: BuiltCancel, signature: Hex): unknown {
  return {
    cancel_orders: {
      tx: built.message,
      signature,
    },
  };
}

function signableMessage(built: BuiltPlace | BuiltCancel): Record<string, unknown> {
  if (built.kind === "place_order") {
    return {
      sender: built.message.sender,
      priceX18: BigInt(built.message.priceX18),
      amount: BigInt(built.message.amount),
      expiration: BigInt(built.message.expiration),
      nonce: BigInt(built.message.nonce),
      appendix: BigInt(built.message.appendix),
    };
  }
  return {
    sender: built.message.sender,
    productIds: built.message.productIds,
    digests: built.message.digests,
    nonce: BigInt(built.message.nonce),
  };
}

function typed(source: Record<string, Array<{ name: string; type: string }>>): Record<string, { name: string; type: string }[]> {
  const out: Record<string, { name: string; type: string }[]> = {};
  for (const [key, fields] of Object.entries(source)) {
    out[key] = fields.map((field) => ({ name: field.name, type: field.type }));
  }
  return out;
}

function asHex(value: unknown): Hex {
  const text = String(value);
  if (!/^0x[0-9a-fA-F]+$/.test(text)) throw new Error(`期望 0x 十六进制，收到 ${text}`);
  return text as Hex;
}
