import { list } from 'postcss';
import { detect } from 'stylehacks';
import insertCloned from '../insertCloned';
import parseTrbl from '../parseTrbl';
import hasAllProps from '../hasAllProps';
import getDecls from '../getDecls';
import getRules from '../getRules';
import getValue from '../getValue';
import mergeRules from '../mergeRules';
import minifyTrbl from '../minifyTrbl';
import minifyWsc from '../minifyWsc';
import canMerge from '../canMerge';
import remove from '../remove';
import trbl from '../trbl';
import isCustomProp from '../isCustomProp';
import canExplode from '../canExplode';
import getLastNode from '../getLastNode';
import parseWsc from '../parseWsc';
import { isValidWsc } from '../validateWsc';

const wsc = ['width', 'style', 'color'];
const defaults = ['medium', 'none', 'currentcolor'];

function borderProperty(...parts) {
  return `border-${parts.join('-')}`;
}

function mapBorderProperty(value) {
  return borderProperty(value);
}

const directions = trbl.map(mapBorderProperty);
const properties = wsc.map(mapBorderProperty);
const directionalProperties = directions.reduce(
  (prev, curr) => prev.concat(wsc.map((prop) => `${curr}-${prop}`)),
  []
);

const precedence = [
  ['border'],
  directions.concat(properties),
  directionalProperties,
];

const allProperties = precedence.reduce((a, b) => a.concat(b));

function getLevel(prop) {
  for (let i = 0; i < precedence.length; i++) {
    if (~precedence[i].indexOf(prop.toLowerCase())) {
      return i;
    }
  }
}

const isValueCustomProp = (value) => value && !!~value.search(/var\s*\(\s*--/i);

function canMergeValues(values) {
  return !values.some(isValueCustomProp);
}

function getColorValue(decl) {
  if (decl.prop.substr(-5) === 'color') {
    return decl.value;
  }

  return parseWsc(decl.value)[2] || defaults[2];
}

function diffingProps(values, nextValues) {
  return wsc.reduce((prev, curr, i) => {
    if (values[i] === nextValues[i]) {
      return prev;
    }

    return [...prev, curr];
  }, []);
}

function mergeRedundant({ values, nextValues, decl, nextDecl, index }) {
  if (!canMerge([decl, nextDecl])) {
    return;
  }

  if (detect(decl) || detect(nextDecl)) {
    return;
  }

  const diff = diffingProps(values, nextValues);

  if (diff.length !== 1) {
    return;
  }

  const prop = diff.pop();
  const position = wsc.indexOf(prop);

  const prop1 = `${nextDecl.prop}-${prop}`;
  const prop2 = `border-${prop}`;

  let props = parseTrbl(values[position]);

  props[index] = nextValues[position];

  const borderValue2 = values.filter((e, i) => i !== position).join(' ');
  const propValue2 = minifyTrbl(props);

  const origLength = (minifyWsc(decl.value) + nextDecl.prop + nextDecl.value)
    .length;
  const newLength1 =
    decl.value.length + prop1.length + minifyWsc(nextValues[position]).length;
  const newLength2 = borderValue2.length + prop2.length + propValue2.length;

  if (newLength1 < newLength2 && newLength1 < origLength) {
    nextDecl.prop = prop1;
    nextDecl.value = nextValues[position];
  }

  if (newLength2 < newLength1 && newLength2 < origLength) {
    decl.value = borderValue2;
    nextDecl.prop = prop2;
    nextDecl.value = propValue2;
  }
}

function isCloseEnough(mapped) {
  return (
    (mapped[0] === mapped[1] && mapped[1] === mapped[2]) ||
    (mapped[1] === mapped[2] && mapped[2] === mapped[3]) ||
    (mapped[2] === mapped[3] && mapped[3] === mapped[0]) ||
    (mapped[3] === mapped[0] && mapped[0] === mapped[1])
  );
}

function getDistinctShorthands(mapped) {
  return mapped.reduce((a, b) => {
    a = Array.isArray(a) ? a : [a];

    if (!~a.indexOf(b)) {
      a.push(b);
    }

    return a;
  });
}

function explode(rule) {
  rule.walkDecls(/^border/i, (decl) => {
    if (!canExplode(decl, false)) {
      return;
    }

    if (detect(decl)) {
      return;
    }

    const prop = decl.prop.toLowerCase();

    // border -> border-trbl
    if (prop === 'border') {
      if (isValidWsc(parseWsc(decl.value))) {
        directions.forEach((direction) => {
          insertCloned(decl.parent, decl, { prop: direction });
        });

        return decl.remove();
      }
    }

    // border-trbl -> border-trbl-wsc
    if (directions.some((direction) => prop === direction)) {
      let values = parseWsc(decl.value);

      if (isValidWsc(values)) {
        wsc.forEach((d, i) => {
          insertCloned(decl.parent, decl, {
            prop: `${prop}-${d}`,
            value: values[i] || defaults[i],
          });
        });

        return decl.remove();
      }
    }

    // border-wsc -> border-trbl-wsc
    wsc.some((style) => {
      if (prop !== borderProperty(style)) {
        return false;
      }

      parseTrbl(decl.value).forEach((value, i) => {
        insertCloned(decl.parent, decl, {
          prop: borderProperty(trbl[i], style),
          value,
        });
      });

      return decl.remove();
    });
  });
}

function merge(rule) {
  // border-trbl-wsc -> border-trbl
  trbl.forEach((direction) => {
    const prop = borderProperty(direction);

    mergeRules(
      rule,
      wsc.map((style) => borderProperty(direction, style)),
      (rules, lastNode) => {
        if (canMerge(rules, false) && !rules.some(detect)) {
          insertCloned(lastNode.parent, lastNode, {
            prop,
            value: rules.map(getValue).join(' '),
          });

          rules.forEach(remove);

          return true;
        }
      }
    );
  });

  // border-trbl-wsc -> border-wsc
  wsc.forEach((style) => {
    const prop = borderProperty(style);

    mergeRules(
      rule,
      trbl.map((direction) => borderProperty(direction, style)),
      (rules, lastNode) => {
        if (canMerge(rules) && !rules.some(detect)) {
          insertCloned(lastNode.parent, lastNode, {
            prop,
            value: minifyTrbl(rules.map(getValue).join(' ')),
          });

          rules.forEach(remove);

          return true;
        }
      }
    );
  });

  // border-trbl -> border-wsc
  mergeRules(rule, directions, (rules, lastNode) => {
    if (rules.some(detect)) {
      return;
    }

    const values = rules.map(({ value }) => value);

    if (!canMergeValues(values)) {
      return;
    }

    const parsed = values.map((value) => parseWsc(value));

    if (!parsed.every(isValidWsc)) {
      return;
    }

    wsc.forEach((d, i) => {
      const value = parsed.map((v) => v[i] || defaults[i]);

      if (canMergeValues(value)) {
        insertCloned(lastNode.parent, lastNode, {
          prop: borderProperty(d),
          value: minifyTrbl(value),
        });
      } else {
        insertCloned(lastNode.parent, lastNode);
      }
    });

    rules.forEach(remove);

    return true;
  });

  // border-wsc -> border
  // border-wsc -> border + border-color
  // border-wsc -> border + border-dir
  mergeRules(rule, properties, (rules, lastNode) => {
    if (rules.some(detect)) {
      return;
    }

    const values = rules.map((node) => parseTrbl(node.value));
    const mapped = [0, 1, 2, 3].map((i) =>
      [values[0][i], values[1][i], values[2][i]].join(' ')
    );

    if (!canMergeValues(mapped)) {
      return;
    }

    const [width, style, color] = rules;
    const reduced = getDistinctShorthands(mapped);

    if (isCloseEnough(mapped) && canMerge(rules, false)) {
      const first =
        mapped.indexOf(reduced[0]) !== mapped.lastIndexOf(reduced[0]);

      const border = insertCloned(lastNode.parent, lastNode, {
        prop: 'border',
        value: first ? reduced[0] : reduced[1],
      });

      if (reduced[1]) {
        const value = first ? reduced[1] : reduced[0];
        const prop = borderProperty(trbl[mapped.indexOf(value)]);

        rule.insertAfter(
          border,
          Object.assign(lastNode.clone(), {
            prop,
            value,
          })
        );
      }
      rules.forEach(remove);

      return true;
    } else if (reduced.length === 1) {
      rule.insertBefore(
        color,
        Object.assign(lastNode.clone(), {
          prop: 'border',
          value: [width, style].map(getValue).join(' '),
        })
      );
      rules
        .filter((node) => node.prop.toLowerCase() !== properties[2])
        .forEach(remove);

      return true;
    }
  });

  // border-wsc -> border + border-trbl
  mergeRules(rule, properties, (rules, lastNode) => {
    if (rules.some(detect)) {
      return;
    }

    const values = rules.map((node) => parseTrbl(node.value));
    const mapped = [0, 1, 2, 3].map((i) =>
      [values[0][i], values[1][i], values[2][i]].join(' ')
    );
    const reduced = getDistinctShorthands(mapped);
    const none = 'medium none currentcolor';

    if (reduced.length > 1 && reduced.length < 4 && reduced.includes(none)) {
      const filtered = mapped.filter((p) => p !== none);
      const mostCommon = reduced.sort(
        (a, b) =>
          mapped.filter((v) => v === b).length -
          mapped.filter((v) => v === a).length
      )[0];
      const borderValue = reduced.length === 2 ? filtered[0] : mostCommon;

      rule.insertBefore(
        lastNode,
        Object.assign(lastNode.clone(), {
          prop: 'border',
          value: borderValue,
        })
      );

      directions.forEach((dir, i) => {
        if (mapped[i] !== borderValue) {
          rule.insertBefore(
            lastNode,
            Object.assign(lastNode.clone(), {
              prop: dir,
              value: mapped[i],
            })
          );
        }
      });

      rules.forEach(remove);

      return true;
    }
  });

  // border-trbl -> border
  // border-trbl -> border + border-trbl
  mergeRules(rule, directions, (rules, lastNode) => {
    if (rules.some(detect)) {
      return;
    }

    const values = rules.map((node) => {
      const wscValue = parseWsc(node.value);

      if (!isValidWsc(wscValue)) {
        return node.value;
      }

      return wscValue.map((value, i) => value || defaults[i]).join(' ');
    });

    const reduced = getDistinctShorthands(values);

    if (isCloseEnough(values)) {
      const first =
        values.indexOf(reduced[0]) !== values.lastIndexOf(reduced[0]);

      rule.insertBefore(
        lastNode,
        Object.assign(lastNode.clone(), {
          prop: 'border',
          value: minifyWsc(first ? values[0] : values[1]),
        })
      );

      if (reduced[1]) {
        const value = first ? reduced[1] : reduced[0];
        const prop = directions[values.indexOf(value)];
        rule.insertBefore(
          lastNode,
          Object.assign(lastNode.clone(), {
            prop: prop,
            value: minifyWsc(value),
          })
        );
      }

      rules.forEach(remove);

      return true;
    }
  });

  // border-trbl-wsc + border-trbl (custom prop) -> border-trbl + border-trbl-wsc (custom prop)
  directions.forEach((direction) => {
    wsc.forEach((style, i) => {
      const prop = `${direction}-${style}`;

      mergeRules(rule, [direction, prop], (rules, lastNode) => {
        if (lastNode.prop !== direction) {
          return;
        }

        const values = parseWsc(lastNode.value);

        if (!isValidWsc(values)) {
          return;
        }

        const wscProp = rules.filter((r) => r !== lastNode)[0];

        if (!isValueCustomProp(values[i]) || isCustomProp(wscProp)) {
          return;
        }

        const wscValue = values[i];

        values[i] = wscProp.value;

        if (canMerge(rules, false) && !rules.some(detect)) {
          insertCloned(lastNode.parent, lastNode, {
            prop,
            value: wscValue,
          });
          lastNode.value = minifyWsc(values);

          wscProp.remove();

          return true;
        }
      });
    });
  });

  // border-wsc + border (custom prop) -> border + border-wsc (custom prop)
  wsc.forEach((style, i) => {
    const prop = borderProperty(style);
    mergeRules(rule, ['border', prop], (rules, lastNode) => {
      if (lastNode.prop !== 'border') {
        return;
      }

      const values = parseWsc(lastNode.value);

      if (!isValidWsc(values)) {
        return;
      }

      const wscProp = rules.filter((r) => r !== lastNode)[0];

      if (!isValueCustomProp(values[i]) || isCustomProp(wscProp)) {
        return;
      }

      const wscValue = values[i];

      values[i] = wscProp.value;

      if (canMerge(rules, false) && !rules.some(detect)) {
        insertCloned(lastNode.parent, lastNode, {
          prop,
          value: wscValue,
        });
        lastNode.value = minifyWsc(values);
        wscProp.remove();

        return true;
      }
    });
  });

  // optimize border-trbl
  let decls = getDecls(rule, directions);

  while (decls.length) {
    const lastNode = decls[decls.length - 1];

    wsc.forEach((d, i) => {
      const names = directions
        .filter((name) => name !== lastNode.prop)
        .map((name) => `${name}-${d}`);

      let nodes = rule.nodes.slice(0, rule.nodes.indexOf(lastNode));

      const border = getLastNode(nodes, 'border');

      if (border) {
        nodes = nodes.slice(nodes.indexOf(border));
      }

      const props = nodes.filter(
        (node) =>
          node.prop &&
          ~names.indexOf(node.prop) &&
          node.important === lastNode.important
      );
      const rules = getRules(props, names);

      if (hasAllProps(rules, ...names) && !rules.some(detect)) {
        const values = rules.map((node) => (node ? node.value : null));
        const filteredValues = values.filter(Boolean);
        const lastNodeValue = list.space(lastNode.value)[i];

        values[directions.indexOf(lastNode.prop)] = lastNodeValue;

        let value = minifyTrbl(values.join(' '));

        if (
          filteredValues[0] === filteredValues[1] &&
          filteredValues[1] === filteredValues[2]
        ) {
          value = filteredValues[0];
        }

        let refNode = props[props.length - 1];

        if (value === lastNodeValue) {
          refNode = lastNode;
          let valueArray = list.space(lastNode.value);
          valueArray.splice(i, 1);
          lastNode.value = valueArray.join(' ');
        }

        insertCloned(refNode.parent, refNode, {
          prop: borderProperty(d),
          value,
        });

        decls = decls.filter((node) => !~rules.indexOf(node));
        rules.forEach(remove);
      }
    });

    decls = decls.filter((node) => node !== lastNode);
  }

  rule.walkDecls('border', (decl) => {
    const nextDecl = decl.next();

    if (!nextDecl || nextDecl.type !== 'decl') {
      return;
    }

    const index = directions.indexOf(nextDecl.prop);

    if (!~index) {
      return;
    }

    const values = parseWsc(decl.value);
    const nextValues = parseWsc(nextDecl.value);

    if (!isValidWsc(values) || !isValidWsc(nextValues)) {
      return;
    }

    const config = {
      values,
      nextValues,
      decl,
      nextDecl,
      index,
    };

    return mergeRedundant(config);
  });

  rule.walkDecls(/^border($|-(top|right|bottom|left)$)/i, (decl) => {
    let values = parseWsc(decl.value);

    if (!isValidWsc(values)) {
      return;
    }

    const position = directions.indexOf(decl.prop);
    let dirs = [...directions];

    dirs.splice(position, 1);
    wsc.forEach((d, i) => {
      const props = dirs.map((dir) => `${dir}-${d}`);

      mergeRules(rule, [decl.prop, ...props], (rules) => {
        if (!rules.includes(decl)) {
          return;
        }

        const longhands = rules.filter((p) => p !== decl);

        if (
          longhands[0].value.toLowerCase() ===
            longhands[1].value.toLowerCase() &&
          longhands[1].value.toLowerCase() ===
            longhands[2].value.toLowerCase() &&
          values[i] !== undefined &&
          longhands[0].value.toLowerCase() === values[i].toLowerCase()
        ) {
          longhands.forEach(remove);

          insertCloned(decl.parent, decl, {
            prop: borderProperty(d),
            value: values[i],
          });

          values[i] = null;
        }
      });

      const newValue = values.join(' ');

      if (newValue) {
        decl.value = newValue;
      } else {
        decl.remove();
      }
    });
  });

  // clean-up values
  rule.walkDecls(/^border($|-(top|right|bottom|left)$)/i, (decl) => {
    decl.value = minifyWsc(decl.value);
  });

  // border-spacing-hv -> border-spacing
  rule.walkDecls(/^border-spacing$/i, (decl) => {
    const value = list.space(decl.value);

    // merge vertical and horizontal dups
    if (value.length > 1 && value[0] === value[1]) {
      decl.value = value.slice(1).join(' ');
    }
  });

  // clean-up rules
  decls = getDecls(rule, allProperties);

  while (decls.length) {
    const lastNode = decls[decls.length - 1];
    const lastPart = lastNode.prop.split('-').pop();

    // remove properties of lower precedence
    const lesser = decls.filter(
      (node) =>
        !detect(lastNode) &&
        !detect(node) &&
        !isCustomProp(lastNode) &&
        node !== lastNode &&
        node.important === lastNode.important &&
        getLevel(node.prop) > getLevel(lastNode.prop) &&
        (!!~node.prop.toLowerCase().indexOf(lastNode.prop) ||
          node.prop.toLowerCase().endsWith(lastPart))
    );

    lesser.forEach(remove);
    decls = decls.filter((node) => !~lesser.indexOf(node));

    // get duplicate properties
    let duplicates = decls.filter(
      (node) =>
        !detect(lastNode) &&
        !detect(node) &&
        node !== lastNode &&
        node.important === lastNode.important &&
        node.prop === lastNode.prop &&
        !(!isCustomProp(node) && isCustomProp(lastNode))
    );

    if (duplicates.length) {
      if (/hsla\(|rgba\(/i.test(getColorValue(lastNode))) {
        const preserve = duplicates
          .filter((node) => !/hsla\(|rgba\(/i.test(getColorValue(node)))
          .pop();

        duplicates = duplicates.filter((node) => node !== preserve);
      }

      duplicates.forEach(remove);
    }

    decls = decls.filter(
      (node) => node !== lastNode && !~duplicates.indexOf(node)
    );
  }
}

export default {
  explode,
  merge,
};
