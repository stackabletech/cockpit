class Base {
  static Check(_value: unknown): boolean {
    return false;
  }
  static Errors(_value: unknown): { message: string }[] {
    return [];
  }
  static Create(): unknown {
    return undefined;
  }
}

const Type = {
  Base,
  Any: Base,
  Array: Base,
  BigInt: Base,
  Boolean: Base,
  Date: Base,
  Function: Base,
  Integer: Base,
  Literal: Base,
  Never: Base,
  Null: Base,
  Number: Base,
  Object: Base,
  Record: Base,
  String: Base,
  Tuple: Base,
  Undefined: Base,
  Union: Base,
  Unknown: Base,
  Void: Base
};

export default Type;
