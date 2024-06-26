import {
  type IToken,
  type CstNode,
  type CstParser,
  type ParserMethod,
} from 'chevrotain';

import { grammarParser } from './parser';
import { mergeConsecutive } from './utils/merge-consecutive';
import { flatten } from 'lodash-es';
import { splitBy } from '../../lib/utils/split-by';

type ParserRuleKeys<P, Key = keyof P> = Key extends keyof P
  ? P[Key] extends ParserMethod<any, any>
    ? Key extends `r_${string}`
      ? Key
      : never
    : never
  : never;

export const createVisitor = <
  P extends CstParser,
  Visitors extends {
    [key in ParserRuleKeys<P>]?: (
      children: Record<string, Array<CstNode | IToken>>,
      visit: (cst: CstNode) => any
    ) => any;
  },
>(
  parser: P,
  visitors: Visitors,
  opt?: {
    default?: (children: CstNode, visit: (cst: any) => any) => any;
  }
) => {
  const visit = (node: CstNode) => {
    if (node.name in visitors) {
      return visitors[node.name as ParserRuleKeys<P>]!(node.children, visit);
    }
    if (opt?.default) {
      return opt.default(node, visit);
    }
    return node;
  };
  return visit;
};

export const grammarCstToAst = createVisitor(grammarParser, {
  r_root: (children, visit) => {
    return {
      fields: (children.fields as CstNode[]).map(visit),
    };
  },
  r_root_field: (children, visit) => {
    if (children.rules) {
      return visit(children.rules[0] as CstNode);
    }
    const name = (children.name[0] as IToken).image;
    if (name === 'tokens') {
      return {
        name,
        tokens: (children.tokens as CstNode[])?.map(visit) ?? [],
      };
    }

    return {
      name: (children.name[0] as IToken).image,
    };
  },
  r_token: (children, visit) => {
    return {
      name: (children.name[0] as IToken).image,
      options:
        (children.options as CstNode[])?.map(visit).reduce((acc, val) => {
          acc[val.name] = val.value;
          return acc;
        }, {}) ?? {},
    };
  },
  r_token_option: (children, visit) => {
    return {
      name: (children.name[0] as IToken).image,
      value: visit(children.value[0] as CstNode),
    };
  },
  r_token_option_value: (children, visit) => {
    if (children.number) {
      return Number((children.number[0] as IToken).image);
    }
    if (children.regex) {
      return new RegExp((children.regex[0] as IToken).image.slice(1, -1));
    }
    if (children.doubleQuoteString) {
      return (children.doubleQuoteString[0] as IToken).image;
    }
    if (children.singleQuoteString) {
      return (children.singleQuoteString[0] as IToken).image;
    }
    if (children.identifier) {
      return {
        type: 'identifier',
        value: (children.identifier[0] as IToken).image,
      };
    }
    if (children.true) {
      return true;
    }
    if (children.false) {
      return false;
    }
    throw new Error(`Failed to map value: ${JSON.stringify(children)}`);
  },

  r_rules: (children, visit) => {
    return {
      name: 'rules',
      rules: (children.rules as CstNode[])?.map(visit) ?? [],
    };
  },
  r_rule: (children, visit) => {
    return {
      name: (children.name[0] as IToken).image,
      body: flatten(
        mergeConsecutive(
          (children.body as CstNode[]).map(visit).filter((v) => v != null),
          (v) => (v?.type === 'or_sequence' ? 'or' : NaN),
          (orBranches) => ({
            type: 'or',
            value: orBranches.map((v) => v.value),
          })
        ).map((v) =>
          v?.type === 'or_sequence'
            ? {
                type: 'or',
                value: [v.value],
              }
            : v
        )
      ),
    };
  },
  r_rule_or_sequence: (children, visit) => {
    return {
      type: 'or_sequence',
      value: visit(children.value[0] as CstNode),
    };
  },
  r_rule_sequence: (children, visit) => {
    if (children.expr) {
      return flatten((children.expr as CstNode[]).map(visit));
    }
    return null;
  },
  r_rule_body_expr: (children, visit) => {
    return visit(children.value[0] as CstNode);
  },

  r_rule_body_expr_binary: (children, visit) => {
    const groups = splitBy(
      children.elems,
      (e) => (e as { name?: string }).name !== 'r_rule_body_expr_unary'
    ).map((group) => (group as CstNode[]).map(visit));
    if (groups.length === 1) {
      return groups[0];
    }

    return {
      type: 'or',
      value: groups,
    };
  },

  r_rule_body_expr_unary: (children, visit) => {
    let value;
    const name = (children.name?.[0] as IToken)?.image;
    let modifier;
    if (children.scalar) {
      value = visit(children.scalar[0] as CstNode);
    }

    if (children.optional) {
      modifier = 'optional';
    }
    if (children.many) {
      modifier = 'many';
    }
    if (children.many1) {
      modifier = 'many1';
    }

    if (value) {
      return {
        name,
        value,
        modifier,
      };
    }
    throw new Error(`Unhandled rule_body_expr ${JSON.stringify(children)}`);
  },
  r_rule_body_expr_scalar: (children, visit) => {
    if (children.singleQuoteString) {
      return (children.singleQuoteString[0] as IToken).image.slice(1, -1);
    }
    if (children.doubleQuoteString) {
      return (children.doubleQuoteString[0] as IToken).image.slice(1, -1);
    }
    if (children.identifier) {
      return {
        type: 'ref',
        value: (children.identifier[0] as IToken).image,
      };
    }
    if (children.pth) {
      return {
        type: 'pth',
        value: visit(children.pth[0] as CstNode),
      };
    }
  },
  r_rule_body_expr_pth: (children, visit) => {
    if (children.value) {
      return visit(children.value[0] as CstNode);
    }
    throw new Error(`Unhandled rule_body_expr_pth ${JSON.stringify(children)}`);
  },
});
